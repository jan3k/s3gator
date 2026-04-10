import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobRetentionService } from "./job-retention.service.js";

const configValues: Record<string, unknown> = {
  RETENTION_JOB_EVENTS_DAYS: 30,
  RETENTION_FAILED_JOB_DAYS: 90,
  RETENTION_TERMINAL_JOB_DAYS: 30,
  RETENTION_AUDIT_LOG_DAYS: 180,
  RETENTION_SECURITY_AUDIT_DAYS: 365,
  RETENTION_UPLOAD_SESSION_DAYS: 30,
  RETENTION_ARCHIVE_ENABLED: false,
  RETENTION_ARCHIVE_BATCH_SIZE: 500,
  ARCHIVE_RETENTION_AUDIT_LOG_DAYS: 730,
  ARCHIVE_RETENTION_JOB_EVENT_DAYS: 365,
  ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS: 1460
};

const configService = {
  get: vi.fn((key: string, fallback: unknown) => (key in configValues ? configValues[key] : fallback))
};

const tx = {
  jobEventArchive: {
    createMany: vi.fn()
  },
  jobEvent: {
    deleteMany: vi.fn()
  },
  auditLogArchive: {
    createMany: vi.fn()
  },
  auditLog: {
    deleteMany: vi.fn()
  }
};

const prisma = {
  jobEvent: {
    deleteMany: vi.fn(),
    findMany: vi.fn()
  },
  auditLog: {
    deleteMany: vi.fn(),
    findMany: vi.fn()
  },
  job: {
    deleteMany: vi.fn()
  },
  uploadSession: {
    deleteMany: vi.fn()
  },
  appSetting: {
    upsert: vi.fn(),
    findUnique: vi.fn()
  },
  auditLogArchive: {
    deleteMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn()
  },
  jobEventArchive: {
    deleteMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn()
  },
  $transaction: vi.fn(async (input: (trx: typeof tx) => Promise<void>) => input(tx))
};

const metricsService = {
  recordRetentionCleanup: vi.fn(),
  recordRetentionDeleted: vi.fn(),
  recordRetentionArchived: vi.fn(),
  recordArchiveGovernanceDeleted: vi.fn()
};

describe("JobRetentionService", () => {
  let service: JobRetentionService;

  beforeEach(() => {
    vi.clearAllMocks();
    configValues.RETENTION_ARCHIVE_ENABLED = false;
    service = new JobRetentionService(configService as never, prisma as never, metricsService as never);

    prisma.jobEvent.deleteMany.mockResolvedValue({ count: 4 });
    prisma.jobEvent.findMany.mockResolvedValue([]);
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 3 });
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.job.deleteMany.mockResolvedValue({ count: 2 });
    prisma.uploadSession.deleteMany.mockResolvedValue({ count: 5 });
    prisma.appSetting.upsert.mockResolvedValue({});
    prisma.appSetting.findUnique.mockResolvedValue(null);
    prisma.auditLogArchive.count.mockResolvedValue(0);
    prisma.auditLogArchive.findFirst.mockResolvedValue(null);
    prisma.auditLogArchive.deleteMany.mockResolvedValue({ count: 0 });
    prisma.jobEventArchive.count.mockResolvedValue(0);
    prisma.jobEventArchive.findFirst.mockResolvedValue(null);
    prisma.jobEventArchive.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("returns configured retention policy", () => {
    const policy = service.getPolicy();

    expect(policy).toEqual({
      jobEventsDays: 30,
      failedJobDays: 90,
      terminalJobDays: 30,
      auditLogDays: 180,
      securityAuditDays: 365,
      uploadSessionDays: 30,
      archiveEnabled: false,
      archiveBatchSize: 500,
      archiveAuditLogDays: 730,
      archiveSecurityAuditDays: 1460,
      archiveJobEventDays: 365
    });
  });

  it("deletes old operational records and records metrics", async () => {
    const summary = await service.runCleanup();

    expect(prisma.jobEvent.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.job.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.uploadSession.deleteMany).toHaveBeenCalledTimes(1);

    expect(metricsService.recordRetentionCleanup).toHaveBeenCalledWith("success");
    expect(metricsService.recordRetentionDeleted).toHaveBeenCalledWith("job_events", 8);
    expect(metricsService.recordRetentionDeleted).toHaveBeenCalledWith("audit_logs", 6);
    expect(metricsService.recordRetentionDeleted).toHaveBeenCalledWith("jobs", 4);
    expect(metricsService.recordRetentionDeleted).toHaveBeenCalledWith("upload_sessions", 5);
    expect(metricsService.recordRetentionArchived).toHaveBeenCalledWith("job_events", 0);
    expect(metricsService.recordRetentionArchived).toHaveBeenCalledWith("audit_logs", 0);
    expect(metricsService.recordArchiveGovernanceDeleted).toHaveBeenCalledWith("job_events_archive", 0);
    expect(metricsService.recordArchiveGovernanceDeleted).toHaveBeenCalledWith("audit_logs_archive", 0);

    expect(summary.deleted.jobsCompletedCanceled).toBe(2);
    expect(summary.deleted.jobsFailed).toBe(2);
    expect(summary.deleted.uploadSessions).toBe(5);
    expect(summary.archivePurged.jobEvents).toBe(0);
    expect(summary.mode).toBe("hard_delete");
    expect(summary.archived.jobEventsCompletedCanceled).toBe(0);
    expect(summary.thresholds.jobEventsBefore).toBeTruthy();
    expect(summary.thresholds.archiveJobEventsBefore).toBeTruthy();
  });

  it("archives and prunes records when archive mode is enabled", async () => {
    configValues.RETENTION_ARCHIVE_ENABLED = true;

    prisma.jobEvent.findMany
      .mockResolvedValueOnce([
        {
          id: "evt-1",
          jobId: "job-1",
          correlationId: "corr-1",
          type: "created",
          level: "INFO",
          message: "queued",
          metadata: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          job: {
            type: "FOLDER_DELETE",
            status: "COMPLETED"
          }
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "evt-2",
          jobId: "job-2",
          correlationId: "corr-2",
          type: "failed",
          level: "ERROR",
          message: "failed",
          metadata: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          job: {
            type: "BUCKET_SYNC",
            status: "FAILED"
          }
        }
      ])
      .mockResolvedValueOnce([]);

    prisma.auditLog.findMany
      .mockResolvedValueOnce([
        {
          id: "log-1",
          actorUserId: "user-1",
          action: "object.delete",
          entityType: "object",
          entityId: "bucket-a/folder",
          metadata: null,
          ipAddress: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z")
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "log-2",
          actorUserId: "user-1",
          action: "auth.login.failure",
          entityType: "session",
          entityId: "sid-1",
          metadata: null,
          ipAddress: null,
          createdAt: new Date("2025-12-01T00:00:00.000Z")
        }
      ])
      .mockResolvedValueOnce([]);

    tx.jobEventArchive.createMany.mockResolvedValue({ count: 1 });
    tx.jobEvent.deleteMany.mockResolvedValue({ count: 1 });
    tx.auditLogArchive.createMany.mockResolvedValue({ count: 1 });
    tx.auditLog.deleteMany.mockResolvedValue({ count: 1 });

    const summary = await service.runCleanup({
      reason: "scheduled",
      jobId: "job-retention-1"
    });

    expect(summary.mode).toBe("archive_and_prune");
    expect(summary.archived.jobEventsCompletedCanceled).toBe(1);
    expect(summary.archived.jobEventsFailed).toBe(1);
    expect(summary.archived.auditLogsGeneral).toBe(1);
    expect(summary.archived.auditLogsSecurity).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(metricsService.recordRetentionArchived).toHaveBeenCalledWith("job_events", 2);
    expect(metricsService.recordRetentionArchived).toHaveBeenCalledWith("audit_logs", 2);
  });

  it("applies second-level archive governance retention windows", async () => {
    configValues.RETENTION_ARCHIVE_ENABLED = false;

    prisma.jobEvent.deleteMany.mockResolvedValue({ count: 0 });
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    prisma.job.deleteMany.mockResolvedValue({ count: 0 });
    prisma.uploadSession.deleteMany.mockResolvedValue({ count: 0 });
    prisma.jobEventArchive.deleteMany.mockResolvedValueOnce({ count: 4 });
    prisma.auditLogArchive.deleteMany
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 2 });

    const summary = await service.runCleanup();

    expect(summary.archivePurged).toEqual({
      jobEvents: 4,
      auditLogsGeneral: 3,
      auditLogsSecurity: 2
    });
    expect(metricsService.recordArchiveGovernanceDeleted).toHaveBeenCalledWith("job_events_archive", 4);
    expect(metricsService.recordArchiveGovernanceDeleted).toHaveBeenCalledWith("audit_logs_archive", 5);
  });
});
