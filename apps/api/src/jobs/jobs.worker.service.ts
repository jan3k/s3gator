import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { z } from "zod";
import {
  createGarageS3Client,
  deleteFileOrFolder,
  renameFileOrFolder,
  GarageAdminApiV2Client
} from "@s3gator/s3";
import { roleSchema, type SessionUser } from "@s3gator/shared";
import type { Job } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service.js";
import { AuditService } from "@/audit/audit.service.js";
import { ConnectionsService } from "@/connections/connections.service.js";
import { MetricsService } from "@/metrics/metrics.service.js";
import { runWithRequestContext } from "@/common/request-context.js";
import { JobsService } from "./jobs.service.js";
import { JobRetentionService } from "./job-retention.service.js";

const actorSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: roleSchema
});

const folderRenamePayloadSchema = z.object({
  actor: actorSchema,
  bucket: z.string().min(1),
  oldKey: z.string().min(1),
  newKey: z.string().min(1),
  ipAddress: z.string().optional(),
  correlationId: z.string().optional()
});

const folderDeletePayloadSchema = z.object({
  actor: actorSchema,
  bucket: z.string().min(1),
  key: z.string().min(1),
  ipAddress: z.string().optional(),
  correlationId: z.string().optional()
});

const bucketSyncPayloadSchema = z.object({
  actor: actorSchema,
  ipAddress: z.string().optional(),
  correlationId: z.string().optional()
});

const uploadCleanupPayloadSchema = z.object({
  actor: actorSchema,
  reason: z.enum(["manual", "scheduled"]),
  correlationId: z.string().optional()
});

const retentionCleanupPayloadSchema = z.object({
  actor: actorSchema,
  reason: z.enum(["manual", "scheduled"]).default("manual"),
  correlationId: z.string().optional()
});

class JobCanceledError extends Error {
  constructor() {
    super("Job canceled");
    this.name = "JobCanceledError";
  }
}

@Injectable()
export class JobsWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsWorkerService.name);
  private readonly tracer = trace.getTracer("s3gator.api.jobs.worker");
  private readonly workerId = `worker-${process.pid}`;
  private readonly pollMs: number;
  private readonly lockTtlSeconds: number;
  private readonly cleanupBatchSize: number;
  private readonly inlineEnabled: boolean;

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly jobsService: JobsService,
    private readonly retentionService: JobRetentionService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly connectionsService: ConnectionsService,
    private readonly metricsService: MetricsService
  ) {
    this.pollMs = this.configService.get<number>("JOB_WORKER_POLL_MS", 2000);
    this.lockTtlSeconds = this.configService.get<number>("JOB_LOCK_TTL_SECONDS", 60);
    this.cleanupBatchSize = this.configService.get<number>("UPLOAD_CLEANUP_BATCH_SIZE", 50);
    this.inlineEnabled = this.configService.get<boolean>("JOB_WORKER_INLINE", false);
  }

  async onModuleInit(): Promise<void> {
    if (this.inlineEnabled) {
      this.logger.log("Starting inline jobs worker");
      this.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);

    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const job = await this.jobsService.claimNext(this.workerId, this.lockTtlSeconds);
      if (!job) {
        return;
      }

      const correlationId = job.correlationId ?? `job-${job.id}`;
      await runWithRequestContext(
        {
          requestId: correlationId,
          correlationId,
          source: "worker",
          jobId: job.id,
          userId: job.createdByUserId ?? undefined
        },
        async () => {
          this.metricsService.recordJobEvent(job.type, "start");
          await this.execute(job, correlationId);
        }
      );
    } catch (error) {
      this.logger.error(`Worker tick failure: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async execute(job: Job, correlationId: string): Promise<void> {
    const span = this.tracer.startSpan("jobs.execute", {
      attributes: {
        "job.id": job.id,
        "job.type": job.type,
        "job.correlation_id": correlationId,
        "worker.id": this.workerId
      }
    });

    try {
      const canceledBeforeStart = await this.jobsService.isCancelRequested(job.id);
      if (canceledBeforeStart) {
        await this.jobsService.recordEvent(job.id, {
          type: "cancel_observed",
          level: "WARN",
          message: "Cancel request observed before job execution started.",
          metadata: {
            checkpoint: "before_start",
            bestEffort: true
          }
        });
        await this.jobsService.markCanceled(job.id);
        span.setStatus({ code: SpanStatusCode.OK });
        return;
      }

      let result: Record<string, unknown>;

      if (job.type === "FOLDER_RENAME") {
        result = await this.executeFolderRename(job, correlationId);
      } else if (job.type === "FOLDER_DELETE") {
        result = await this.executeFolderDelete(job, correlationId);
      } else if (job.type === "BUCKET_SYNC") {
        result = await this.executeBucketSync(job, correlationId);
      } else if (job.type === "UPLOAD_CLEANUP") {
        result = await this.executeUploadCleanup(job);
      } else {
        result = await this.executeRetentionCleanup(job, correlationId);
      }

      await this.jobsService.markCompleted(job.id, result);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      if (error instanceof JobCanceledError) {
        await this.jobsService.markCanceled(job.id);
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        const message = (error as Error).message;
        if (job.type === "RETENTION_CLEANUP") {
          this.metricsService.recordRetentionCleanup("failure");
        }
        await this.jobsService.recordEvent(job.id, {
          type: "step_error",
          level: "ERROR",
          message: "Job step failed.",
          metadata: {
            error: message
          }
        });
        await this.jobsService.markFailed(job.id, message);
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
      }
    } finally {
      span.end();
    }
  }

  private async executeFolderRename(job: Job, correlationId: string): Promise<Record<string, unknown>> {
    const payload = folderRenamePayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    await this.jobsService.recordEvent(job.id, {
      type: "folder_rename.started",
      message: "Folder rename started.",
      metadata: {
        bucket: payload.bucket,
        oldKey: payload.oldKey,
        newKey: payload.newKey
      }
    });

    const s3 = await this.getS3Client();
    const startedAt = Date.now();

    let lastProgressEventAt = 0;
    let lastProcessedForEvent = 0;

    await this.throwIfCancelRequested(job.id, "before_rename_start");
    const renameResult = await renameFileOrFolder(s3, payload.oldKey, payload.newKey, payload.bucket, (progress) => {
      const progressPayload = {
        totalItems: progress.total,
        processedItems: progress.processed,
        metadata: {
          copied: progress.copied,
          deleted: progress.deleted,
          failed: progress.failed,
          currentKey: progress.currentKey ?? null
        }
      };

      const now = Date.now();
      const emitEvent =
        progress.processed === progress.total ||
        progress.processed - lastProcessedForEvent >= Math.max(1, Math.ceil(Math.max(progress.total, 1) / 20)) ||
        now - lastProgressEventAt >= 5000;

      if (emitEvent) {
        lastProcessedForEvent = progress.processed;
        lastProgressEventAt = now;
      }

      void this.jobsService.markProgress(job.id, progressPayload, {
        emitEvent,
        message: "Folder rename progress updated."
      });
    });
    await this.throwIfCancelRequested(job.id, "after_rename_end");

    this.metricsService.recordS3Duration("folder_rename", (Date.now() - startedAt) / 1000);
    if (renameResult.failed.length > 0) {
      this.metricsService.recordS3Failure("folder_rename");
    }

    await this.jobsService.recordEvent(job.id, {
      type: "folder_rename.completed_step",
      level: renameResult.failed.length > 0 ? "WARN" : "INFO",
      message: "Folder rename step completed.",
      metadata: {
        copied: renameResult.copied,
        deleted: renameResult.deleted,
        failed: renameResult.failed.length
      }
    });

    await this.auditService.record({
      actor,
      action: "object.rename",
      entityType: "object",
      entityId: `${payload.bucket}/${payload.oldKey}`,
      metadata: {
        mode: "job",
        jobId: job.id,
        correlationId,
        result: renameResult
      },
      ipAddress: payload.ipAddress
    });

    return {
      ...renameResult,
      mode: "job"
    };
  }

  private async executeFolderDelete(job: Job, correlationId: string): Promise<Record<string, unknown>> {
    const payload = folderDeletePayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    await this.jobsService.recordEvent(job.id, {
      type: "folder_delete.started",
      message: "Folder delete started.",
      metadata: {
        bucket: payload.bucket,
        key: payload.key
      }
    });

    await this.jobsService.markProgress(
      job.id,
      {
        metadata: {
          stage: "deleting"
        }
      },
      {
        emitEvent: true,
        message: "Folder delete started."
      }
    );

    const s3 = await this.getS3Client();
    const startedAt = Date.now();
    await this.throwIfCancelRequested(job.id, "before_delete_start");
    const deleteResult = await deleteFileOrFolder(s3, payload.key, payload.bucket);
    await this.throwIfCancelRequested(job.id, "after_delete_end");

    this.metricsService.recordS3Duration("folder_delete", (Date.now() - startedAt) / 1000);
    if (deleteResult.failed.length > 0) {
      this.metricsService.recordS3Failure("folder_delete");
    }

    await this.jobsService.markProgress(
      job.id,
      {
        totalItems: deleteResult.deleted + deleteResult.failed.length,
        processedItems: deleteResult.deleted + deleteResult.failed.length,
        metadata: {
          deleted: deleteResult.deleted,
          failed: deleteResult.failed.length
        }
      },
      {
        emitEvent: true,
        message: "Folder delete step completed."
      }
    );

    await this.jobsService.recordEvent(job.id, {
      type: "folder_delete.completed_step",
      level: deleteResult.failed.length > 0 ? "WARN" : "INFO",
      message: "Folder delete step completed.",
      metadata: {
        deleted: deleteResult.deleted,
        failed: deleteResult.failed.length
      }
    });

    await this.auditService.record({
      actor,
      action: "object.delete",
      entityType: "object",
      entityId: `${payload.bucket}/${payload.key}`,
      metadata: {
        mode: "job",
        jobId: job.id,
        correlationId,
        result: deleteResult
      },
      ipAddress: payload.ipAddress
    });

    return {
      ...deleteResult,
      mode: "job"
    };
  }

  private async executeBucketSync(job: Job, correlationId: string): Promise<Record<string, unknown>> {
    const payload = bucketSyncPayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    await this.jobsService.recordEvent(job.id, {
      type: "bucket_sync.started",
      message: "Bucket sync started.",
      metadata: {
        actorUserId: actor.id
      }
    });

    const conn = await this.connectionsService.getDefaultConnectionWithSecrets();
    if (!conn.adminApiUrl || !conn.adminToken) {
      throw new Error("Default connection does not include Admin API credentials");
    }

    const adminClient = new GarageAdminApiV2Client({
      baseUrl: conn.adminApiUrl,
      token: conn.adminToken,
      defaultHeaders: {
        "x-request-id": correlationId
      }
    });

    const remoteBuckets = await adminClient.listBuckets();

    let processed = 0;
    let lastProgressEventAt = 0;

    for (const bucket of remoteBuckets) {
      await this.throwIfCancelRequested(job.id, "bucket_sync_loop");

      const preferredName = bucket.globalAliases[0] ?? bucket.id;
      await this.prisma.bucket.upsert({
        where: { name: preferredName },
        create: {
          name: preferredName,
          garageBucketId: bucket.id,
          connectionId: conn.id
        },
        update: {
          garageBucketId: bucket.id,
          connectionId: conn.id
        }
      });
      processed += 1;

      const now = Date.now();
      const emitEvent =
        processed === remoteBuckets.length ||
        processed % Math.max(1, Math.ceil(Math.max(remoteBuckets.length, 1) / 10)) === 0 ||
        now - lastProgressEventAt >= 5000;

      if (emitEvent) {
        lastProgressEventAt = now;
      }

      await this.jobsService.markProgress(
        job.id,
        {
          totalItems: remoteBuckets.length,
          processedItems: processed,
          metadata: {
            lastBucket: preferredName
          }
        },
        {
          emitEvent,
          message: "Bucket sync progress updated."
        }
      );
    }

    await this.jobsService.recordEvent(job.id, {
      type: "bucket_sync.completed_step",
      message: "Bucket sync step completed.",
      metadata: {
        synced: remoteBuckets.length,
        connectionId: conn.id
      }
    });

    await this.auditService.record({
      actor,
      action: "bucket.sync",
      entityType: "bucket",
      metadata: {
        mode: "job",
        jobId: job.id,
        correlationId,
        synced: remoteBuckets.length,
        connectionId: conn.id
      },
      ipAddress: payload.ipAddress
    });

    return {
      synced: remoteBuckets.length,
      connectionId: conn.id,
      mode: "job"
    };
  }

  private async executeUploadCleanup(job: Job): Promise<Record<string, unknown>> {
    const payload = uploadCleanupPayloadSchema.parse(job.payload);

    await this.jobsService.recordEvent(job.id, {
      type: "upload_cleanup.started",
      message: "Upload cleanup started.",
      metadata: {
        reason: payload.reason,
        batchSize: this.cleanupBatchSize
      }
    });

    const expired = await this.prisma.uploadSession.findMany({
      where: {
        status: {
          in: ["INITIATED", "IN_PROGRESS"]
        },
        expiresAt: {
          lt: new Date()
        }
      },
      take: this.cleanupBatchSize,
      include: {
        bucket: true
      }
    });

    let processed = 0;

    for (const session of expired) {
      try {
        await this.throwIfCancelRequested(job.id, "upload_cleanup_loop");

        await this.jobsService.markProgress(
          job.id,
          {
            totalItems: expired.length,
            processedItems: processed,
            metadata: {
              currentUploadSessionId: session.id
            }
          },
          {
            emitEvent: processed === 0 || processed === expired.length - 1 || processed % 10 === 0,
            message: "Upload cleanup progress updated."
          }
        );

        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: {
            status: "FAILED",
            error: "Upload session expired",
            lastActivityAt: new Date()
          }
        });

        await this.jobsService.recordEvent(job.id, {
          type: "upload_cleanup.item_processed",
          message: "Expired upload session marked as failed.",
          metadata: {
            uploadSessionId: session.id,
            bucket: session.bucket?.name ?? null,
            objectKey: session.objectKey
          }
        });

        if (session.bucket) {
          this.metricsService.recordS3Duration("upload_cleanup", 0);
          await this.auditService.record({
            actor: payload.actor,
            action: "object.upload.cleanup",
            entityType: "upload_session",
            entityId: session.id,
            metadata: {
              bucket: session.bucket.name,
              objectKey: session.objectKey,
              reason: payload.reason
            }
          });
        }
      } catch (error) {
        this.metricsService.recordS3Failure("upload_cleanup");
        await this.jobsService.recordEvent(job.id, {
          type: "upload_cleanup.item_failed",
          level: "WARN",
          message: "Upload cleanup failed for session.",
          metadata: {
            uploadSessionId: session.id,
            error: (error as Error).message
          }
        });
        this.logger.warn(`Upload cleanup failed for session ${session.id}: ${(error as Error).message}`);
      }

      processed += 1;
    }

    await this.jobsService.recordEvent(job.id, {
      type: "upload_cleanup.completed_step",
      message: "Upload cleanup completed.",
      metadata: {
        cleaned: processed,
        totalExpired: expired.length
      }
    });

    return {
      cleaned: processed,
      totalExpired: expired.length
    };
  }

  private async executeRetentionCleanup(job: Job, correlationId: string): Promise<Record<string, unknown>> {
    const payload = retentionCleanupPayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    await this.jobsService.recordEvent(job.id, {
      type: "retention_cleanup.started",
      message: "Retention cleanup started.",
      metadata: {
        reason: payload.reason
      }
    });

    await this.throwIfCancelRequested(job.id, "before_retention_cleanup");

    const summary = await this.retentionService.runCleanup();

    await this.throwIfCancelRequested(job.id, "after_retention_cleanup");

    await this.jobsService.markProgress(
      job.id,
      {
        metadata: {
          deleted: summary.deleted,
          thresholds: summary.thresholds
        }
      },
      {
        emitEvent: true,
        message: "Retention cleanup summary recorded."
      }
    );

    await this.jobsService.recordEvent(job.id, {
      type: "retention_cleanup.completed_step",
      message: "Retention cleanup completed.",
      metadata: {
        reason: payload.reason,
        deleted: summary.deleted
      }
    });

    await this.auditService.record({
      actor,
      action: "maintenance.retention.cleanup",
      entityType: "maintenance",
      entityId: job.id,
      metadata: {
        mode: "job",
        jobId: job.id,
        correlationId,
        reason: payload.reason,
        deleted: summary.deleted
      }
    });

    return summary as unknown as Record<string, unknown>;
  }

  private async getS3Client() {
    const conn = await this.connectionsService.getDefaultConnectionWithSecrets();
    return createGarageS3Client({
      endpoint: conn.endpoint,
      region: conn.region,
      forcePathStyle: conn.forcePathStyle,
      accessKeyId: conn.accessKeyId,
      secretAccessKey: conn.secretAccessKey
    });
  }

  private async throwIfCancelRequested(jobId: string, checkpoint: string): Promise<void> {
    if (await this.jobsService.isCancelRequested(jobId)) {
      await this.jobsService.recordEvent(jobId, {
        type: "cancel_observed",
        level: "WARN",
        message: "Cancel request observed at worker checkpoint.",
        metadata: {
          checkpoint,
          bestEffort: true
        }
      });
      throw new JobCanceledError();
    }
  }
}
