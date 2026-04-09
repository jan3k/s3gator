import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { JobType, type Job, type Prisma } from "@prisma/client";
import type { JobPublic, SessionUser } from "@s3gator/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@/prisma/prisma.service.js";
import { RedisService } from "@/redis/redis.service.js";
import { MetricsService } from "@/metrics/metrics.service.js";

export interface FolderRenameJobPayload {
  actor: SessionUser;
  bucket: string;
  oldKey: string;
  newKey: string;
  ipAddress?: string;
}

export interface FolderDeleteJobPayload {
  actor: SessionUser;
  bucket: string;
  key: string;
  ipAddress?: string;
}

export interface BucketSyncJobPayload {
  actor: SessionUser;
  ipAddress?: string;
}

export interface UploadCleanupJobPayload {
  actor: SessionUser;
  reason: "manual" | "scheduled";
}

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly metricsService: MetricsService
  ) {}

  async enqueueFolderRename(payload: FolderRenameJobPayload): Promise<JobPublic> {
    return this.enqueue("FOLDER_RENAME", payload, payload.actor.id);
  }

  async enqueueFolderDelete(payload: FolderDeleteJobPayload): Promise<JobPublic> {
    return this.enqueue("FOLDER_DELETE", payload, payload.actor.id);
  }

  async enqueueBucketSync(payload: BucketSyncJobPayload): Promise<JobPublic> {
    return this.enqueue("BUCKET_SYNC", payload, payload.actor.id);
  }

  async enqueueUploadCleanup(payload: UploadCleanupJobPayload): Promise<JobPublic> {
    return this.enqueue("UPLOAD_CLEANUP", payload, payload.actor.id);
  }

  async list(actor: SessionUser, input: { limit?: number; scope?: "mine" | "all" }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const scope = input.scope ?? "mine";

    if (scope !== "all" || actor.role === "USER") {
      const items = await this.prisma.job.findMany({
        where: { createdByUserId: actor.id },
        orderBy: { createdAt: "desc" },
        take: limit
      });
      return items.map((item) => this.toPublic(item));
    }

    if (actor.role === "SUPER_ADMIN") {
      const items = await this.prisma.job.findMany({
        orderBy: { createdAt: "desc" },
        take: limit
      });
      return items.map((item) => this.toPublic(item));
    }

    const scopedBuckets = await this.loadAdminScopeBucketNames(actor.id);
    const items = await this.prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit * 5, 2000)
    });

    const filtered = items.filter((item) => this.canAdminAccessJob(actor.id, item, scopedBuckets));
    return filtered.slice(0, limit).map((item) => this.toPublic(item));
  }

  async getById(actor: SessionUser, jobId: string): Promise<JobPublic> {
    const item = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!item) {
      throw new NotFoundException("Job not found");
    }

    if (!(await this.canView(actor, item))) {
      throw new ForbiddenException("Not allowed to view this job");
    }

    return this.toPublic(item);
  }

  async requestCancel(actor: SessionUser, jobId: string): Promise<JobPublic> {
    const item = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!item) {
      throw new NotFoundException("Job not found");
    }

    if (!(await this.canCancel(actor, item))) {
      throw new ForbiddenException("Not allowed to cancel this job");
    }

    const now = new Date();

    if (item.status === "QUEUED") {
      const canceled = await this.prisma.job.update({
        where: { id: item.id },
        data: {
          status: "CANCELED",
          cancelRequestedAt: now,
          completedAt: now
        }
      });

      this.metricsService.recordJobEvent(item.type, "cancel");
      await this.releaseJobLock(canceled);
      return this.toPublic(canceled);
    }

    const updated = await this.prisma.job.update({
      where: { id: item.id },
      data: {
        cancelRequestedAt: now
      }
    });

    return this.toPublic(updated);
  }

  async claimNext(workerId: string, lockTtlSeconds: number): Promise<Job | null> {
    const staleBefore = new Date(Date.now() - lockTtlSeconds * 1000);

    const candidate = await this.prisma.job.findFirst({
      where: {
        OR: [
          { status: "QUEUED" },
          {
            status: "RUNNING",
            lockedAt: { lt: staleBefore }
          }
        ]
      },
      orderBy: { createdAt: "asc" }
    });

    if (!candidate) {
      return null;
    }

    const lockToken = `${workerId}:${randomUUID()}`;
    const lockAcquired = await this.redisService.acquireLock(
      this.redisService.key(`job:lock:${candidate.id}`),
      lockToken,
      lockTtlSeconds
    );

    if (!lockAcquired) {
      return null;
    }

    const now = new Date();
    const updateResult = await this.prisma.job.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "QUEUED" },
          {
            status: "RUNNING",
            lockedAt: {
              lt: staleBefore
            }
          }
        ]
      },
      data: {
        status: "RUNNING",
        startedAt: candidate.startedAt ?? now,
        lockedAt: now,
        lockKey: lockToken
      }
    });

    if (updateResult.count === 0) {
      await this.redisService.releaseLock(this.redisService.key(`job:lock:${candidate.id}`), lockToken);
      return null;
    }

    return this.prisma.job.findUnique({ where: { id: candidate.id } });
  }

  async markProgress(jobId: string, progress: Record<string, unknown>): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        progress: progress as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    });
  }

  async markCompleted(jobId: string, result?: Record<string, unknown>): Promise<void> {
    const existing = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) {
      return;
    }

    const now = new Date();
    const completed = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        result: result as Prisma.InputJsonValue | undefined
      }
    });

    const durationSeconds = completed.startedAt ? (now.getTime() - completed.startedAt.getTime()) / 1000 : undefined;
    this.metricsService.recordJobEvent(completed.type, "complete", durationSeconds);
    await this.releaseJobLock(completed);
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    const existing = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) {
      return;
    }

    const now = new Date();
    const failed = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: now,
        failureSummary: error.slice(0, 2000)
      }
    });

    const durationSeconds = failed.startedAt ? (now.getTime() - failed.startedAt.getTime()) / 1000 : undefined;
    this.metricsService.recordJobEvent(failed.type, "fail", durationSeconds);
    await this.releaseJobLock(failed);
  }

  async markCanceled(jobId: string): Promise<void> {
    const existing = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) {
      return;
    }

    const now = new Date();
    const canceled = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: "CANCELED",
        completedAt: now,
        cancelRequestedAt: existing.cancelRequestedAt ?? now
      }
    });

    const durationSeconds = canceled.startedAt ? (now.getTime() - canceled.startedAt.getTime()) / 1000 : undefined;
    this.metricsService.recordJobEvent(canceled.type, "cancel", durationSeconds);
    await this.releaseJobLock(canceled);
  }

  async isCancelRequested(jobId: string): Promise<boolean> {
    const item = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { cancelRequestedAt: true }
    });

    return Boolean(item?.cancelRequestedAt);
  }

  private async enqueue(type: JobType, payload: unknown, createdByUserId?: string): Promise<JobPublic> {
    const created = await this.prisma.job.create({
      data: {
        type,
        status: "QUEUED",
        createdByUserId,
        payload: payload as Prisma.InputJsonValue
      }
    });

    return this.toPublic(created);
  }

  private async canView(actor: SessionUser, job: Job): Promise<boolean> {
    if (actor.role === "SUPER_ADMIN") {
      return true;
    }

    if (actor.role === "ADMIN") {
      const scopedBuckets = await this.loadAdminScopeBucketNames(actor.id);
      return this.canAdminAccessJob(actor.id, job, scopedBuckets);
    }

    return job.createdByUserId === actor.id;
  }

  private async canCancel(actor: SessionUser, job: Job): Promise<boolean> {
    if (actor.role === "SUPER_ADMIN") {
      return true;
    }

    if (actor.role === "ADMIN") {
      const scopedBuckets = await this.loadAdminScopeBucketNames(actor.id);
      return this.canAdminAccessJob(actor.id, job, scopedBuckets);
    }

    return job.createdByUserId === actor.id;
  }

  private canAdminAccessJob(adminUserId: string, job: Job, scopedBuckets: Set<string>): boolean {
    if (job.createdByUserId === adminUserId) {
      return true;
    }

    const payloadBucket = this.readPayloadBucket(job.payload);
    if (!payloadBucket) {
      return false;
    }

    return scopedBuckets.has(payloadBucket);
  }

  private readPayloadBucket(payload: Prisma.JsonValue): string | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const maybeBucket = payloadRecord.bucket;
    return typeof maybeBucket === "string" && maybeBucket.length > 0 ? maybeBucket : null;
  }

  private async loadAdminScopeBucketNames(adminUserId: string): Promise<Set<string>> {
    const scopes = await this.prisma.adminBucketScope.findMany({
      where: { adminUserId },
      include: {
        bucket: {
          select: {
            name: true
          }
        }
      }
    });

    return new Set(scopes.map((scope) => scope.bucket.name));
  }

  private toPublic(item: Job): JobPublic {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      createdByUserId: item.createdByUserId,
      createdAt: item.createdAt.toISOString(),
      startedAt: item.startedAt?.toISOString() ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
      cancelRequestedAt: item.cancelRequestedAt?.toISOString() ?? null,
      failureSummary: item.failureSummary,
      progress: (item.progress as Record<string, unknown> | null) ?? null,
      result: (item.result as Record<string, unknown> | null) ?? null
    };
  }

  private async releaseJobLock(job: Job): Promise<void> {
    if (!job.lockKey) {
      return;
    }

    await this.redisService.releaseLock(this.redisService.key(`job:lock:${job.id}`), job.lockKey);
  }
}
