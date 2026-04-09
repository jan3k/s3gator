import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import { JobsService } from "./jobs.service.js";

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
  ipAddress: z.string().optional()
});

const folderDeletePayloadSchema = z.object({
  actor: actorSchema,
  bucket: z.string().min(1),
  key: z.string().min(1),
  ipAddress: z.string().optional()
});

const bucketSyncPayloadSchema = z.object({
  actor: actorSchema,
  ipAddress: z.string().optional()
});

const uploadCleanupPayloadSchema = z.object({
  actor: actorSchema,
  reason: z.enum(["manual", "scheduled"])
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

      this.metricsService.recordJobEvent(job.type, "start");
      await this.execute(job);
    } catch (error) {
      this.logger.error(`Worker tick failure: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async execute(job: Job): Promise<void> {
    const canceledBeforeStart = await this.jobsService.isCancelRequested(job.id);
    if (canceledBeforeStart) {
      await this.jobsService.markCanceled(job.id);
      return;
    }

    try {
      let result: Record<string, unknown>;

      if (job.type === "FOLDER_RENAME") {
        result = await this.executeFolderRename(job);
      } else if (job.type === "FOLDER_DELETE") {
        result = await this.executeFolderDelete(job);
      } else if (job.type === "BUCKET_SYNC") {
        result = await this.executeBucketSync(job);
      } else {
        result = await this.executeUploadCleanup(job);
      }

      await this.jobsService.markCompleted(job.id, result);
    } catch (error) {
      if (error instanceof JobCanceledError) {
        await this.jobsService.markCanceled(job.id);
        return;
      }
      await this.jobsService.markFailed(job.id, (error as Error).message);
    }
  }

  private async executeFolderRename(job: Job): Promise<Record<string, unknown>> {
    const payload = folderRenamePayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    const s3 = await this.getS3Client();
    const startedAt = Date.now();
    await this.throwIfCancelRequested(job.id);
    const renameResult = await renameFileOrFolder(s3, payload.oldKey, payload.newKey, payload.bucket, (progress) => {
      void this.jobsService.markProgress(job.id, {
        totalItems: progress.total,
        processedItems: progress.processed,
        metadata: {
          copied: progress.copied,
          deleted: progress.deleted,
          failed: progress.failed,
          currentKey: progress.currentKey ?? null
        }
      });
    });
    await this.throwIfCancelRequested(job.id);

    this.metricsService.recordS3Duration("folder_rename", (Date.now() - startedAt) / 1000);
    if (renameResult.failed.length > 0) {
      this.metricsService.recordS3Failure("folder_rename");
    }

    await this.auditService.record({
      actor,
      action: "object.rename",
      entityType: "object",
      entityId: `${payload.bucket}/${payload.oldKey}`,
      metadata: {
        mode: "job",
        jobId: job.id,
        result: renameResult
      },
      ipAddress: payload.ipAddress
    });

    return {
      ...renameResult,
      mode: "job"
    };
  }

  private async executeFolderDelete(job: Job): Promise<Record<string, unknown>> {
    const payload = folderDeletePayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    await this.jobsService.markProgress(job.id, {
      metadata: {
        stage: "deleting"
      }
    });

    const s3 = await this.getS3Client();
    const startedAt = Date.now();
    await this.throwIfCancelRequested(job.id);
    const deleteResult = await deleteFileOrFolder(s3, payload.key, payload.bucket);
    await this.throwIfCancelRequested(job.id);

    this.metricsService.recordS3Duration("folder_delete", (Date.now() - startedAt) / 1000);
    if (deleteResult.failed.length > 0) {
      this.metricsService.recordS3Failure("folder_delete");
    }

    await this.jobsService.markProgress(job.id, {
      totalItems: deleteResult.deleted + deleteResult.failed.length,
      processedItems: deleteResult.deleted + deleteResult.failed.length,
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
        result: deleteResult
      },
      ipAddress: payload.ipAddress
    });

    return {
      ...deleteResult,
      mode: "job"
    };
  }

  private async executeBucketSync(job: Job): Promise<Record<string, unknown>> {
    const payload = bucketSyncPayloadSchema.parse(job.payload);
    const actor = payload.actor satisfies SessionUser;

    const conn = await this.connectionsService.getDefaultConnectionWithSecrets();
    if (!conn.adminApiUrl || !conn.adminToken) {
      throw new Error("Default connection does not include Admin API credentials");
    }

    const adminClient = new GarageAdminApiV2Client({
      baseUrl: conn.adminApiUrl,
      token: conn.adminToken
    });

    const remoteBuckets = await adminClient.listBuckets();

    let processed = 0;
    for (const bucket of remoteBuckets) {
      await this.throwIfCancelRequested(job.id);

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

      await this.jobsService.markProgress(job.id, {
        totalItems: remoteBuckets.length,
        processedItems: processed
      });
    }

    await this.auditService.record({
      actor,
      action: "bucket.sync",
      entityType: "bucket",
      metadata: {
        mode: "job",
        jobId: job.id,
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
        await this.throwIfCancelRequested(job.id);

        await this.jobsService.markProgress(job.id, {
          totalItems: expired.length,
          processedItems: processed,
          metadata: {
            currentUploadSessionId: session.id
          }
        });

        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: {
            status: "FAILED",
            error: "Upload session expired",
            lastActivityAt: new Date()
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
        this.logger.warn(`Upload cleanup failed for session ${session.id}: ${(error as Error).message}`);
      }

      processed += 1;
    }

    return {
      cleaned: processed,
      totalExpired: expired.length
    };
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

  private async throwIfCancelRequested(jobId: string): Promise<void> {
    if (await this.jobsService.isCancelRequested(jobId)) {
      throw new JobCanceledError();
    }
  }
}
