import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobRetentionService } from "./job-retention.service.js";

const configService = {
  get: vi.fn((key: string, fallback: unknown) => {
    if (key === "RETENTION_JOB_EVENTS_DAYS") return 30;
    if (key === "RETENTION_FAILED_JOB_DAYS") return 90;
    if (key === "RETENTION_TERMINAL_JOB_DAYS") return 30;
    if (key === "RETENTION_AUDIT_LOG_DAYS") return 180;
    if (key === "RETENTION_SECURITY_AUDIT_DAYS") return 365;
    if (key === "RETENTION_UPLOAD_SESSION_DAYS") return 30;
    return fallback;
  })
};

const prisma = {
  jobEvent: {
    deleteMany: vi.fn()
  },
  auditLog: {
    deleteMany: vi.fn()
  },
  job: {
    deleteMany: vi.fn()
  },
  uploadSession: {
    deleteMany: vi.fn()
  }
};

const metricsService = {
  recordRetentionCleanup: vi.fn(),
  recordRetentionDeleted: vi.fn()
};

describe("JobRetentionService", () => {
  let service: JobRetentionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new JobRetentionService(configService as never, prisma as never, metricsService as never);

    prisma.jobEvent.deleteMany.mockResolvedValue({ count: 4 });
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 3 });
    prisma.job.deleteMany.mockResolvedValue({ count: 2 });
    prisma.uploadSession.deleteMany.mockResolvedValue({ count: 5 });
  });

  it("returns configured retention policy", () => {
    const policy = service.getPolicy();

    expect(policy).toEqual({
      jobEventsDays: 30,
      failedJobDays: 90,
      terminalJobDays: 30,
      auditLogDays: 180,
      securityAuditDays: 365,
      uploadSessionDays: 30
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

    expect(summary.deleted.jobsCompletedCanceled).toBe(2);
    expect(summary.deleted.jobsFailed).toBe(2);
    expect(summary.deleted.uploadSessions).toBe(5);
    expect(summary.thresholds.jobEventsBefore).toBeTruthy();
  });
});
