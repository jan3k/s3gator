import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceSchedulerService } from "./maintenance-scheduler.service.js";

const configValues: Record<string, unknown> = {
  MAINTENANCE_SCHEDULER_ENABLED: true,
  MAINTENANCE_SCHEDULER_TICK_SECONDS: 30,
  MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS: 60,
  MAINTENANCE_RETENTION_INTERVAL_MINUTES: 10,
  MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES: 5,
  MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES: 0,
  MAINTENANCE_TASK_RETENTION_ENABLED: true,
  MAINTENANCE_TASK_UPLOAD_CLEANUP_ENABLED: true,
  MAINTENANCE_TASK_BUCKET_SYNC_ENABLED: false
};

const configService = {
  get: vi.fn((key: string, fallback: unknown) => (key in configValues ? configValues[key] : fallback))
};

const prisma = {
  appSetting: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  },
  user: {
    findFirst: vi.fn()
  },
  job: {
    findFirst: vi.fn()
  }
};

const redisService = {
  key: vi.fn((key: string) => `s3gator:${key}`),
  acquireLock: vi.fn(),
  releaseLock: vi.fn()
};

const jobsService = {
  enqueueRetentionCleanup: vi.fn(),
  enqueueUploadCleanup: vi.fn(),
  enqueueBucketSync: vi.fn()
};

const auditService = {
  record: vi.fn()
};

const metricsService = {
  recordSchedulerRun: vi.fn()
};

describe("MaintenanceSchedulerService", () => {
  let service: MaintenanceSchedulerService;

  beforeEach(() => {
    vi.clearAllMocks();

    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.appSetting.upsert.mockResolvedValue({});
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: "super-1",
        username: "admin",
        email: "admin@example.local",
        displayName: "Admin",
        role: { code: "SUPER_ADMIN" }
      })
      .mockResolvedValue({
        id: "super-1",
        username: "admin",
        email: "admin@example.local",
        displayName: "Admin",
        role: { code: "SUPER_ADMIN" }
      });
    prisma.job.findFirst.mockResolvedValue(null);

    redisService.acquireLock.mockResolvedValue(true);
    redisService.releaseLock.mockResolvedValue(true);

    jobsService.enqueueRetentionCleanup.mockResolvedValue({ id: "job-ret" });
    jobsService.enqueueUploadCleanup.mockResolvedValue({ id: "job-up" });
    jobsService.enqueueBucketSync.mockResolvedValue({ id: "job-sync" });

    service = new MaintenanceSchedulerService(
      configService as never,
      prisma as never,
      redisService as never,
      jobsService as never,
      auditService as never,
      metricsService as never
    );
  });

  it("queues due scheduled maintenance tasks and records heartbeat", async () => {
    await service.runOnce();

    expect(redisService.acquireLock).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueueRetentionCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "scheduled" })
    );
    expect(jobsService.enqueueUploadCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "scheduled" })
    );
    expect(jobsService.enqueueBucketSync).not.toHaveBeenCalled();
    expect(metricsService.recordSchedulerRun).toHaveBeenCalledWith("retention_cleanup", "queued");
    expect(metricsService.recordSchedulerRun).toHaveBeenCalledWith("upload_cleanup", "queued");
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: "maintenance.scheduler.heartbeat"
        }
      })
    );
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: "maintenance.scheduler.task.retention_cleanup"
        }
      })
    );
    expect(auditService.record).toHaveBeenCalledTimes(2);
  });

  it("records skipped_active when same job type is already running or queued", async () => {
    prisma.job.findFirst
      .mockResolvedValueOnce({ id: "active-ret" })
      .mockResolvedValueOnce({ id: "active-up" });

    await service.runOnce();

    expect(jobsService.enqueueRetentionCleanup).not.toHaveBeenCalled();
    expect(jobsService.enqueueUploadCleanup).not.toHaveBeenCalled();
    expect(metricsService.recordSchedulerRun).toHaveBeenCalledWith("retention_cleanup", "skipped_active");
    expect(metricsService.recordSchedulerRun).toHaveBeenCalledWith("upload_cleanup", "skipped_active");
  });

  it("runTaskNow is duplicate-safe and does not enqueue if active job exists", async () => {
    prisma.job.findFirst.mockResolvedValue({ id: "active-ret" });

    const result = await service.runTaskNow(
      "retention_cleanup",
      {
        id: "super-1",
        username: "admin",
        email: "admin@example.local",
        displayName: "Admin",
        role: "SUPER_ADMIN"
      },
      "req-1"
    );

    expect(result.result).toBe("skipped_active");
    expect(result.jobId).toBe("active-ret");
    expect(jobsService.enqueueRetentionCleanup).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "maintenance.scheduler.run_once"
      })
    );
  });

  it("returns scheduler status from persisted app settings", async () => {
    prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "maintenance.scheduler.heartbeat") {
        return {
          value: "2026-04-10T12:00:00.000Z"
        };
      }

      if (where.key === "maintenance.scheduler.task.retention_cleanup") {
        return {
          value: {
            ranAt: "2026-04-10T12:00:00.000Z",
            nextRunAt: "2026-04-10T12:10:00.000Z",
            result: "queued",
            trigger: "scheduled",
            taskEnabled: true,
            intervalMinutes: 10,
            lastSuccessAt: "2026-04-10T12:00:00.000Z",
            lastFailureAt: null,
            lastHeartbeatAt: "2026-04-10T12:00:00.000Z",
            lastJobId: "job-ret",
            error: null
          }
        };
      }

      return null;
    });

    const status = await service.getStatus();

    expect(status.enabled).toBe(true);
    expect(status.lastHeartbeatAt).toBe("2026-04-10T12:00:00.000Z");
    expect(status.tasks).toHaveLength(3);
    expect(status.tasks[0]).toMatchObject({
      task: "retention_cleanup",
      lastResult: "queued",
      lastTrigger: "scheduled",
      lastSuccessAt: "2026-04-10T12:00:00.000Z",
      lastJobId: "job-ret"
    });
    expect(status.tasks[2]).toMatchObject({
      task: "bucket_sync",
      enabled: false,
      intervalMinutes: 0
    });
  });
});
