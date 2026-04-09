import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobsService } from "./jobs.service.js";

function makeJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-04-09T12:00:00.000Z");
  return {
    id: "job-1",
    type: "FOLDER_DELETE",
    status: "QUEUED",
    correlationId: null,
    attemptCount: 0,
    maxAttempts: 1,
    retryable: false,
    nextRetryAt: null,
    lastError: null,
    createdByUserId: "creator-1",
    createdAt: now,
    startedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    failureSummary: null,
    payload: {
      bucket: "bucket-a"
    },
    progress: null,
    result: null,
    lockKey: null,
    lockedAt: null,
    updatedAt: now,
    ...overrides
  };
}

const prisma = {
  job: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn()
  },
  jobEvent: {
    create: vi.fn(),
    findMany: vi.fn()
  },
  adminBucketScope: {
    findMany: vi.fn()
  }
};

const redisService = {
  key: vi.fn((value: string) => value),
  acquireLock: vi.fn(),
  releaseLock: vi.fn()
};

const metricsService = {
  recordJobEvent: vi.fn(),
  recordJobRetryEvent: vi.fn(),
  recordJobReclaim: vi.fn()
};

const configService = {
  get: vi.fn((key: string, fallback: unknown) => {
    if (key === "JOB_RETRY_MAX_ATTEMPTS_BUCKET_SYNC") return 5;
    if (key === "JOB_RETRY_MAX_ATTEMPTS_UPLOAD_CLEANUP") return 3;
    if (key === "JOB_RETRY_MAX_ATTEMPTS_RETENTION_CLEANUP") return 3;
    if (key === "JOB_RETRY_BACKOFF_SECONDS_BUCKET_SYNC") return 15;
    if (key === "JOB_RETRY_BACKOFF_SECONDS_UPLOAD_CLEANUP") return 30;
    if (key === "JOB_RETRY_BACKOFF_SECONDS_RETENTION_CLEANUP") return 60;
    if (key === "JOB_RETRY_MAX_BACKOFF_SECONDS") return 900;
    return fallback;
  })
};

describe("JobsService scoped admin access", () => {
  let service: JobsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new JobsService(configService as never, prisma as never, redisService as never, metricsService as never);
  });

  it("allows ADMIN to view scoped bucket job", async () => {
    prisma.job.findUnique.mockResolvedValue(
      makeJob({
        createdByUserId: "other-user",
        payload: { bucket: "bucket-a" }
      })
    );
    prisma.adminBucketScope.findMany.mockResolvedValue([
      {
        bucket: { name: "bucket-a" }
      }
    ]);

    const result = await service.getById(
      {
        id: "admin-1",
        username: "admin",
        email: "admin@example.com",
        displayName: "Admin",
        role: "ADMIN"
      },
      "job-1"
    );

    expect(result.id).toBe("job-1");
  });

  it("blocks ADMIN from viewing out-of-scope job", async () => {
    prisma.job.findUnique.mockResolvedValue(
      makeJob({
        id: "job-2",
        createdByUserId: "other-user",
        payload: { bucket: "bucket-x" }
      })
    );
    prisma.adminBucketScope.findMany.mockResolvedValue([
      {
        bucket: { name: "bucket-a" }
      }
    ]);

    await expect(
      service.getById(
        {
          id: "admin-1",
          username: "admin",
          email: "admin@example.com",
          displayName: "Admin",
          role: "ADMIN"
        },
        "job-2"
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("filters list scope=all for ADMIN by own/scoped jobs", async () => {
    prisma.job.findMany.mockResolvedValue([
      makeJob({ id: "job-own", createdByUserId: "admin-1", payload: { bucket: "bucket-x" } }),
      makeJob({ id: "job-scope", createdByUserId: "other", payload: { bucket: "bucket-a" } }),
      makeJob({ id: "job-denied", createdByUserId: "other", payload: { bucket: "bucket-z" } }),
      makeJob({ id: "job-global", type: "BUCKET_SYNC", createdByUserId: "other", payload: { actor: { id: "x" } } })
    ]);
    prisma.adminBucketScope.findMany.mockResolvedValue([
      {
        bucket: { name: "bucket-a" }
      }
    ]);

    const result = await service.list(
      {
        id: "admin-1",
        username: "admin",
        email: "admin@example.com",
        displayName: "Admin",
        role: "ADMIN"
      },
      { scope: "all", limit: 10 }
    );

    expect(result.map((job) => job.id)).toEqual(["job-own", "job-scope"]);
  });

  it("returns job detail with timeline events", async () => {
    prisma.job.findUnique.mockResolvedValue(
      makeJob({
        id: "job-detail-1",
        correlationId: "req-123"
      })
    );
    prisma.jobEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        jobId: "job-detail-1",
        correlationId: "req-123",
        type: "created",
        level: "INFO",
        message: "Job queued",
        metadata: null,
        createdAt: new Date("2026-04-09T12:00:01.000Z")
      }
    ]);

    const detail = await service.getDetail(
      {
        id: "super-1",
        username: "root",
        email: "root@example.com",
        displayName: "Root",
        role: "SUPER_ADMIN"
      },
      "job-detail-1",
      100
    );

    expect(detail.job.id).toBe("job-detail-1");
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.type).toBe("created");
    expect(detail.events[0]?.correlationId).toBe("req-123");
  });

  it("schedules retry for retryable job type before max attempts", async () => {
    prisma.job.findUnique.mockResolvedValueOnce(
      makeJob({
        id: "job-retry-1",
        type: "BUCKET_SYNC",
        status: "RUNNING",
        retryable: true,
        attemptCount: 1,
        maxAttempts: 3,
        lockKey: "lock-1",
        startedAt: new Date("2026-04-09T12:00:00.000Z")
      })
    );
    prisma.job.update.mockResolvedValue(
      makeJob({
        id: "job-retry-1",
        type: "BUCKET_SYNC",
        status: "QUEUED",
        retryable: true,
        attemptCount: 1,
        maxAttempts: 3,
        lockKey: null,
        nextRetryAt: new Date("2026-04-09T12:00:15.000Z"),
        lastError: "temporary failure"
      })
    );

    await service.markFailed("job-retry-1", "temporary failure");

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-retry-1" },
        data: expect.objectContaining({
          status: "QUEUED",
          nextRetryAt: expect.any(Date)
        })
      })
    );
    expect(metricsService.recordJobRetryEvent).toHaveBeenCalledWith("BUCKET_SYNC", "scheduled");
    expect(metricsService.recordJobEvent).not.toHaveBeenCalledWith("BUCKET_SYNC", "fail", expect.anything());
    expect(prisma.jobEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "retry_scheduled"
        })
      })
    );
  });

  it("does not retry non-retryable destructive job types", async () => {
    prisma.job.findUnique.mockResolvedValueOnce(
      makeJob({
        id: "job-no-retry-1",
        type: "FOLDER_DELETE",
        status: "RUNNING",
        retryable: false,
        attemptCount: 1,
        maxAttempts: 1,
        lockKey: "lock-2",
        startedAt: new Date("2026-04-09T12:00:00.000Z")
      })
    );
    prisma.job.update.mockResolvedValue(
      makeJob({
        id: "job-no-retry-1",
        type: "FOLDER_DELETE",
        status: "FAILED",
        retryable: false,
        attemptCount: 1,
        maxAttempts: 1,
        lockKey: "lock-2",
        completedAt: new Date("2026-04-09T12:00:10.000Z"),
        failureSummary: "permanent failure",
        lastError: "permanent failure"
      })
    );

    await service.markFailed("job-no-retry-1", "permanent failure");

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          nextRetryAt: null
        })
      })
    );
    expect(metricsService.recordJobRetryEvent).toHaveBeenCalledWith("FOLDER_DELETE", "skipped_non_retryable");
    expect(metricsService.recordJobEvent).toHaveBeenCalledWith("FOLDER_DELETE", "fail", undefined);
  });

  it("marks retryable job as failed when retry budget is exhausted", async () => {
    prisma.job.findUnique.mockResolvedValueOnce(
      makeJob({
        id: "job-retry-exhausted-1",
        type: "BUCKET_SYNC",
        status: "RUNNING",
        retryable: true,
        attemptCount: 5,
        maxAttempts: 5,
        lockKey: "lock-exh",
        startedAt: new Date("2026-04-09T12:00:00.000Z")
      })
    );
    prisma.job.update.mockResolvedValue(
      makeJob({
        id: "job-retry-exhausted-1",
        type: "BUCKET_SYNC",
        status: "FAILED",
        retryable: true,
        attemptCount: 5,
        maxAttempts: 5,
        completedAt: new Date("2026-04-09T12:00:10.000Z"),
        failureSummary: "boom",
        lastError: "boom"
      })
    );

    await service.markFailed("job-retry-exhausted-1", "boom");

    expect(metricsService.recordJobRetryEvent).toHaveBeenCalledWith("BUCKET_SYNC", "exhausted");
    expect(prisma.jobEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "retry_exhausted"
        })
      })
    );
  });

  it("emits reclaim and retry-start events when stale running job is claimed", async () => {
    const staleLockedAt = new Date(Date.now() - 120_000);
    prisma.job.findFirst.mockResolvedValue(
      makeJob({
        id: "job-stale-1",
        type: "BUCKET_SYNC",
        status: "RUNNING",
        retryable: true,
        attemptCount: 1,
        maxAttempts: 3,
        lockedAt: staleLockedAt
      })
    );
    redisService.acquireLock.mockResolvedValue(true);
    prisma.job.updateMany.mockResolvedValue({ count: 1 });
    prisma.job.findUnique.mockResolvedValue(
      makeJob({
        id: "job-stale-1",
        type: "BUCKET_SYNC",
        status: "RUNNING",
        retryable: true,
        attemptCount: 2,
        maxAttempts: 3
      })
    );

    const claimed = await service.claimNext("worker-1", 60);

    expect(claimed?.id).toBe("job-stale-1");
    expect(metricsService.recordJobReclaim).toHaveBeenCalledWith("BUCKET_SYNC");
    expect(metricsService.recordJobRetryEvent).toHaveBeenCalledWith("BUCKET_SYNC", "started");
    expect(prisma.jobEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "reclaimed"
        })
      })
    );
  });
});
