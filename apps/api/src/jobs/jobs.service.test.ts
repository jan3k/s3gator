import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobsService } from "./jobs.service.js";

function makeJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-04-09T12:00:00.000Z");
  return {
    id: "job-1",
    type: "FOLDER_DELETE",
    status: "QUEUED",
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
  recordJobEvent: vi.fn()
};

describe("JobsService scoped admin access", () => {
  let service: JobsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new JobsService(prisma as never, redisService as never, metricsService as never);
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
});
