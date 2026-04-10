import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobEventLevel, JobType, type Job, type JobEvent, type Prisma } from "@prisma/client";
import type { JobDetailPublic, JobEventPublic, JobPublic, SessionUser } from "@s3gator/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@/prisma/prisma.service.js";
import { RedisService } from "@/redis/redis.service.js";
import { MetricsService } from "@/metrics/metrics.service.js";
import { getCorrelationId } from "@/common/request-context.js";

export interface FolderRenameJobPayload {
  actor: SessionUser;
  bucket: string;
  oldKey: string;
  newKey: string;
  ipAddress?: string;
  correlationId?: string;
}

export interface FolderDeleteJobPayload {
  actor: SessionUser;
  bucket: string;
  key: string;
  ipAddress?: string;
  correlationId?: string;
}

export interface BucketSyncJobPayload {
  actor: SessionUser;
  reason: "manual" | "scheduled";
  ipAddress?: string;
  correlationId?: string;
}

export interface UploadCleanupJobPayload {
  actor: SessionUser;
  reason: "manual" | "scheduled";
  correlationId?: string;
}

export interface RetentionCleanupJobPayload {
  actor: SessionUser;
  reason: "manual" | "scheduled";
  correlationId?: string;
}

interface JobEventInput {
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
  level?: JobEventLevel;
  correlationId?: string | null;
}

interface JobRetryPolicy {
  retryable: boolean;
  maxAttempts: number;
  baseBackoffSeconds: number;
}

export interface ListArchivedJobEventsInput {
  limit?: number;
  offset?: number;
  jobId?: string;
  type?: string;
  level?: JobEventLevel;
  correlationId?: string;
  search?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly metricsService: MetricsService
  ) {}

  async enqueueFolderRename(payload: FolderRenameJobPayload): Promise<JobPublic> {
    return this.enqueue("FOLDER_RENAME", payload, payload.actor.id, payload.correlationId);
  }

  async enqueueFolderDelete(payload: FolderDeleteJobPayload): Promise<JobPublic> {
    return this.enqueue("FOLDER_DELETE", payload, payload.actor.id, payload.correlationId);
  }

  async enqueueBucketSync(payload: BucketSyncJobPayload): Promise<JobPublic> {
    return this.enqueue("BUCKET_SYNC", payload, payload.actor.id, payload.correlationId);
  }

  async enqueueUploadCleanup(payload: UploadCleanupJobPayload): Promise<JobPublic> {
    return this.enqueue("UPLOAD_CLEANUP", payload, payload.actor.id, payload.correlationId);
  }

  async enqueueRetentionCleanup(payload: RetentionCleanupJobPayload): Promise<JobPublic> {
    return this.enqueue("RETENTION_CLEANUP", payload, payload.actor.id, payload.correlationId);
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

  async getDetail(actor: SessionUser, jobId: string, eventsLimit = 200): Promise<JobDetailPublic> {
    const item = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!item) {
      throw new NotFoundException("Job not found");
    }

    if (!(await this.canView(actor, item))) {
      throw new ForbiddenException("Not allowed to view this job");
    }

    const events = await this.prisma.jobEvent.findMany({
      where: { jobId: item.id },
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(eventsLimit, 1), 1000)
    });

    return {
      job: this.toPublic(item),
      events: events.map((event) => this.toEventPublic(event))
    };
  }

  async listEvents(actor: SessionUser, jobId: string, limit = 200): Promise<JobEventPublic[]> {
    const item = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!item) {
      throw new NotFoundException("Job not found");
    }

    if (!(await this.canView(actor, item))) {
      throw new ForbiddenException("Not allowed to view this job");
    }

    const events = await this.prisma.jobEvent.findMany({
      where: { jobId: item.id },
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(limit, 1), 1000)
    });

    return events.map((event) => this.toEventPublic(event));
  }

  async listArchivedEvents(
    actor: SessionUser,
    input: ListArchivedJobEventsInput
  ): Promise<{
    items: Array<{
      id: string;
      sourceJobEventId: string | null;
      jobId: string;
      jobType: string | null;
      jobStatus: string | null;
      correlationId: string | null;
      type: string;
      level: JobEventLevel;
      message: string;
      metadata: Record<string, unknown> | null;
      createdAt: string;
      archivedAt: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    if (actor.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Archived job event access is limited to SUPER_ADMIN");
    }

    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const offset = Math.max(input.offset ?? 0, 0);
    const fromDate = parseIsoDate(input.from);
    const toDate = parseIsoDate(input.to);

    const where: Prisma.JobEventArchiveWhereInput = {
      jobId: input.jobId ?? undefined,
      type: input.type
        ? {
            contains: input.type,
            mode: "insensitive"
          }
        : undefined,
      level: input.level ?? undefined,
      correlationId: input.correlationId
        ? {
            equals: input.correlationId
          }
        : undefined,
      createdAt:
        fromDate || toDate
          ? {
              gte: fromDate ?? undefined,
              lte: toDate ?? undefined
            }
          : undefined,
      OR: input.search
        ? [
            {
              type: {
                contains: input.search,
                mode: "insensitive"
              }
            },
            {
              message: {
                contains: input.search,
                mode: "insensitive"
              }
            }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      this.prisma.jobEventArchive.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit
      }),
      this.prisma.jobEventArchive.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        sourceJobEventId: item.sourceJobEventId,
        jobId: item.jobId,
        jobType: item.jobType,
        jobStatus: item.jobStatus,
        correlationId: item.correlationId,
        type: item.type,
        level: item.level,
        message: item.message,
        metadata: (item.metadata as Record<string, unknown> | null) ?? null,
        createdAt: item.createdAt.toISOString(),
        archivedAt: item.archivedAt.toISOString()
      })),
      total,
      limit,
      offset
    };
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
          completedAt: now,
          nextRetryAt: null
        }
      });

      await this.createEvent(canceled, {
        type: "canceled_requested",
        level: "WARN",
        message: "Cancellation requested while job was queued.",
        metadata: {
          statusAtRequest: item.status,
          immediateCancel: true
        }
      });
      await this.createEvent(canceled, {
        type: "canceled",
        level: "WARN",
        message: "Job canceled before execution.",
        metadata: {
          reason: "cancel_requested_queued"
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

    await this.createEvent(updated, {
      type: "canceled_requested",
      level: "WARN",
      message: "Cancellation requested. Cancel is best-effort and observed at worker checkpoints.",
      metadata: {
        statusAtRequest: item.status,
        bestEffort: true
      }
    });

    return this.toPublic(updated);
  }

  async claimNext(workerId: string, lockTtlSeconds: number): Promise<Job | null> {
    const staleBefore = new Date(Date.now() - lockTtlSeconds * 1000);
    const now = new Date();

    const candidate = await this.prisma.job.findFirst({
      where: {
        OR: [
          {
            status: "QUEUED",
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }]
          },
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

    const updateResult = await this.prisma.job.updateMany({
      where: {
        id: candidate.id,
        OR: [
          {
            status: "QUEUED",
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }]
          },
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
        lockKey: lockToken,
        nextRetryAt: null,
        attemptCount: {
          increment: 1
        }
      }
    });

    if (updateResult.count === 0) {
      await this.redisService.releaseLock(this.redisService.key(`job:lock:${candidate.id}`), lockToken);
      return null;
    }

    const claimed = await this.prisma.job.findUnique({ where: { id: candidate.id } });
    if (!claimed) {
      return null;
    }

    const reclaimedStaleRun = candidate.status === "RUNNING";
    await this.createEvent(claimed, {
      type: "claimed",
      message: "Job claimed by worker.",
      metadata: {
        workerId,
        lockKey: claimed.lockKey,
        reclaimedStaleRun,
        attemptCount: claimed.attemptCount,
        maxAttempts: claimed.maxAttempts
      }
    });
    if (reclaimedStaleRun) {
      this.metricsService.recordJobReclaim(claimed.type);
      await this.createEvent(claimed, {
        type: "reclaimed",
        level: "WARN",
        message: "Stale running job reclaimed by worker after lock timeout.",
        metadata: {
          workerId,
          lockKey: claimed.lockKey,
          attemptCount: claimed.attemptCount,
          staleBefore: staleBefore.toISOString()
        }
      });
    }
    if (claimed.attemptCount > 1) {
      this.metricsService.recordJobRetryEvent(claimed.type, "started");
      await this.createEvent(claimed, {
        type: "retry_started",
        level: "WARN",
        message: "Retry attempt started.",
        metadata: {
          workerId,
          lockKey: claimed.lockKey,
          attemptCount: claimed.attemptCount,
          maxAttempts: claimed.maxAttempts
        }
      });
    }
    await this.createEvent(claimed, {
      type: "started",
      message: "Job execution started.",
      metadata: {
        workerId,
        lockKey: claimed.lockKey,
        attemptCount: claimed.attemptCount
      }
    });

    return claimed;
  }

  async markProgress(
    jobId: string,
    progress: Record<string, unknown>,
    options?: { emitEvent?: boolean; message?: string; level?: JobEventLevel }
  ): Promise<void> {
    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        progress: progress as Prisma.InputJsonValue
      }
    });

    if (options?.emitEvent) {
      await this.createEvent(updated, {
        type: "progress_update",
        level: options.level,
        message: options.message ?? "Job progress updated.",
        metadata: progress
      });
    }
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
        nextRetryAt: null,
        lastError: null,
        result: result as Prisma.InputJsonValue | undefined
      }
    });

    const durationSeconds = completed.startedAt ? (now.getTime() - completed.startedAt.getTime()) / 1000 : undefined;
    this.metricsService.recordJobEvent(completed.type, "complete", durationSeconds);

    await this.createEvent(completed, {
      type: "completed",
      message: "Job completed.",
      metadata: {
        durationSeconds,
        hasResult: result !== undefined,
        attemptCount: completed.attemptCount,
        maxAttempts: completed.maxAttempts
      }
    });

    await this.releaseJobLock(completed);
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    const existing = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) {
      return;
    }

    const truncatedError = error.slice(0, 2000);
    const now = new Date();
    const shouldRetry = existing.retryable && existing.attemptCount < existing.maxAttempts;

    if (shouldRetry) {
      const delaySeconds = this.computeBackoffSeconds(existing.type, existing.attemptCount);
      const nextRetryAt = new Date(now.getTime() + delaySeconds * 1000);

      const retryScheduled = await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: "QUEUED",
          completedAt: null,
          lockKey: null,
          lockedAt: null,
          nextRetryAt,
          lastError: truncatedError,
          failureSummary: truncatedError
        }
      });

      this.metricsService.recordJobRetryEvent(existing.type, "scheduled");

      await this.createEvent(retryScheduled, {
        type: "retry_scheduled",
        level: "WARN",
        message: "Job failed and retry was scheduled.",
        metadata: {
          attemptCount: existing.attemptCount,
          maxAttempts: existing.maxAttempts,
          nextRetryAt: nextRetryAt.toISOString(),
          delaySeconds,
          error: truncatedError
        }
      });

      await this.releaseJobLock(existing);
      return;
    }

    const failed = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: now,
        nextRetryAt: null,
        lastError: truncatedError,
        failureSummary: truncatedError
      }
    });

    const durationSeconds = failed.startedAt ? (now.getTime() - failed.startedAt.getTime()) / 1000 : undefined;
    this.metricsService.recordJobEvent(failed.type, "fail", durationSeconds);

    if (failed.retryable) {
      this.metricsService.recordJobRetryEvent(failed.type, "exhausted");
      await this.createEvent(failed, {
        type: "retry_exhausted",
        level: "ERROR",
        message: "Retry attempts exhausted; job marked failed.",
        metadata: {
          attemptCount: failed.attemptCount,
          maxAttempts: failed.maxAttempts,
          error: truncatedError
        }
      });
    } else {
      this.metricsService.recordJobRetryEvent(failed.type, "skipped_non_retryable");
      await this.createEvent(failed, {
        type: "retry_skipped_non_retryable",
        level: "WARN",
        message: "Retry skipped because job type is non-retryable.",
        metadata: {
          attemptCount: failed.attemptCount,
          maxAttempts: failed.maxAttempts
        }
      });
    }

    await this.createEvent(failed, {
      type: "failed",
      level: "ERROR",
      message: "Job failed.",
      metadata: {
        durationSeconds,
        attemptCount: failed.attemptCount,
        maxAttempts: failed.maxAttempts,
        error: truncatedError
      }
    });

    await this.releaseJobLock(existing);
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
        cancelRequestedAt: existing.cancelRequestedAt ?? now,
        nextRetryAt: null
      }
    });

    const durationSeconds = canceled.startedAt ? (now.getTime() - canceled.startedAt.getTime()) / 1000 : undefined;
    this.metricsService.recordJobEvent(canceled.type, "cancel", durationSeconds);

    await this.createEvent(canceled, {
      type: "canceled",
      level: "WARN",
      message: "Job canceled. In-flight S3 calls may have completed before checkpoint cancellation.",
      metadata: {
        durationSeconds,
        bestEffort: true,
        attemptCount: canceled.attemptCount,
        maxAttempts: canceled.maxAttempts
      }
    });

    await this.releaseJobLock(existing);
  }

  async isCancelRequested(jobId: string): Promise<boolean> {
    const item = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { cancelRequestedAt: true }
    });

    return Boolean(item?.cancelRequestedAt);
  }

  async recordEvent(jobId: string, input: JobEventInput): Promise<void> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        correlationId: true
      }
    });

    if (!job) {
      return;
    }

    await this.createEvent(job, input);
  }

  private async enqueue(
    type: JobType,
    payload: unknown,
    createdByUserId?: string,
    correlationId?: string
  ): Promise<JobPublic> {
    const resolvedCorrelationId = correlationId ?? getCorrelationId();
    const policy = this.getRetryPolicy(type);

    const created = await this.prisma.job.create({
      data: {
        type,
        status: "QUEUED",
        correlationId: resolvedCorrelationId,
        retryable: policy.retryable,
        maxAttempts: policy.maxAttempts,
        createdByUserId,
        payload: sanitizeJobMetadata(payload) as Prisma.InputJsonValue
      }
    });

    await this.createEvent(created, {
      type: "created",
      message: "Job queued.",
      metadata: {
        type: created.type,
        createdByUserId: created.createdByUserId,
        retryable: created.retryable,
        maxAttempts: created.maxAttempts
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

  private getRetryPolicy(type: JobType): JobRetryPolicy {
    if (type === "BUCKET_SYNC") {
      return {
        retryable: true,
        maxAttempts: this.configService.get<number>("JOB_RETRY_MAX_ATTEMPTS_BUCKET_SYNC", 5),
        baseBackoffSeconds: this.configService.get<number>("JOB_RETRY_BACKOFF_SECONDS_BUCKET_SYNC", 15)
      };
    }

    if (type === "UPLOAD_CLEANUP") {
      return {
        retryable: true,
        maxAttempts: this.configService.get<number>("JOB_RETRY_MAX_ATTEMPTS_UPLOAD_CLEANUP", 3),
        baseBackoffSeconds: this.configService.get<number>("JOB_RETRY_BACKOFF_SECONDS_UPLOAD_CLEANUP", 30)
      };
    }

    if (type === "RETENTION_CLEANUP") {
      return {
        retryable: true,
        maxAttempts: this.configService.get<number>("JOB_RETRY_MAX_ATTEMPTS_RETENTION_CLEANUP", 3),
        baseBackoffSeconds: this.configService.get<number>("JOB_RETRY_BACKOFF_SECONDS_RETENTION_CLEANUP", 60)
      };
    }

    return {
      retryable: false,
      maxAttempts: 1,
      baseBackoffSeconds: 0
    };
  }

  private computeBackoffSeconds(type: JobType, attemptCount: number): number {
    const policy = this.getRetryPolicy(type);
    const maxBackoffSeconds = this.configService.get<number>("JOB_RETRY_MAX_BACKOFF_SECONDS", 900);
    const exponent = Math.max(attemptCount - 1, 0);
    const raw = policy.baseBackoffSeconds * 2 ** exponent;
    return Math.min(Math.max(raw, policy.baseBackoffSeconds), maxBackoffSeconds);
  }

  private toPublic(item: Job): JobPublic {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      correlationId: item.correlationId ?? null,
      createdByUserId: item.createdByUserId,
      attemptCount: item.attemptCount,
      maxAttempts: item.maxAttempts,
      retryable: item.retryable,
      nextRetryAt: item.nextRetryAt?.toISOString() ?? null,
      lastError: item.lastError ?? null,
      createdAt: item.createdAt.toISOString(),
      startedAt: item.startedAt?.toISOString() ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
      cancelRequestedAt: item.cancelRequestedAt?.toISOString() ?? null,
      failureSummary: item.failureSummary,
      progress: (item.progress as Record<string, unknown> | null) ?? null,
      result: (item.result as Record<string, unknown> | null) ?? null
    };
  }

  private toEventPublic(item: JobEvent): JobEventPublic {
    return {
      id: item.id,
      jobId: item.jobId,
      correlationId: item.correlationId ?? null,
      type: item.type,
      level: item.level,
      message: item.message,
      metadata: (item.metadata as Record<string, unknown> | null) ?? null,
      createdAt: item.createdAt.toISOString()
    };
  }

  private async releaseJobLock(job: Job): Promise<void> {
    if (!job.lockKey) {
      return;
    }

    await this.redisService.releaseLock(this.redisService.key(`job:lock:${job.id}`), job.lockKey);
  }

  private async createEvent(
    job: {
      id: string;
      correlationId: string | null;
    },
    input: JobEventInput
  ): Promise<void> {
    await this.prisma.jobEvent.create({
      data: {
        jobId: job.id,
        correlationId: input.correlationId ?? job.correlationId,
        type: input.type,
        level: input.level ?? "INFO",
        message: input.message,
        metadata: sanitizeJobMetadata(input.metadata) as Prisma.InputJsonValue | undefined
      }
    });
  }
}

const REDACT_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "credential",
  "accesskey",
  "bindpassword"
] as const;

function sanitizeJobMetadata(input: unknown): unknown {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeJobMetadata(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const lowered = key.toLowerCase();
      if (REDACT_KEYS.some((segment) => lowered.includes(segment))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeJobMetadata(value);
      }
    }

    return result;
  }

  return String(input);
}

function parseIsoDate(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}
