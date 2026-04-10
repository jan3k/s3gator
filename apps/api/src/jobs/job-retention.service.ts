import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type JobStatus } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service.js";
import { MetricsService } from "@/metrics/metrics.service.js";

const SECURITY_AUDIT_ACTION_PREFIXES = [
  "auth.",
  "user.",
  "settings.",
  "bucket.grants",
  "bucket.admin_scope",
  "connection.",
  "session."
] as const;

const RETENTION_LAST_RUN_KEY = "maintenance.retention.last_run";

type RetentionReason = "manual" | "scheduled";

export interface RetentionPolicy {
  jobEventsDays: number;
  failedJobDays: number;
  terminalJobDays: number;
  auditLogDays: number;
  securityAuditDays: number;
  uploadSessionDays: number;
  archiveEnabled: boolean;
  archiveBatchSize: number;
}

export interface RetentionCleanupSummary {
  policy: RetentionPolicy;
  mode: "hard_delete" | "archive_and_prune";
  thresholds: {
    jobEventsBefore: string;
    failedJobsBefore: string;
    terminalJobsBefore: string;
    auditLogsBefore: string;
    securityAuditBefore: string;
    uploadSessionsBefore: string;
  };
  archived: {
    jobEventsCompletedCanceled: number;
    jobEventsFailed: number;
    auditLogsGeneral: number;
    auditLogsSecurity: number;
  };
  deleted: {
    jobEventsCompletedCanceled: number;
    jobEventsFailed: number;
    auditLogsGeneral: number;
    auditLogsSecurity: number;
    jobsCompletedCanceled: number;
    jobsFailed: number;
    uploadSessions: number;
  };
}

export interface RetentionLastRunState {
  ranAt: string;
  status: "success" | "failure";
  mode: "hard_delete" | "archive_and_prune";
  reason: RetentionReason;
  jobId: string | null;
  error: string | null;
  archived: Record<string, number>;
  deleted: Record<string, number>;
}

export interface ArchiveStats {
  enabled: boolean;
  auditLogArchiveCount: number;
  jobEventArchiveCount: number;
  lastArchivedAt: string | null;
}

@Injectable()
export class JobRetentionService {
  private readonly logger = new Logger(JobRetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService
  ) {}

  getPolicy(): RetentionPolicy {
    return {
      jobEventsDays: this.configService.get<number>("RETENTION_JOB_EVENTS_DAYS", 30),
      failedJobDays: this.configService.get<number>("RETENTION_FAILED_JOB_DAYS", 90),
      terminalJobDays: this.configService.get<number>("RETENTION_TERMINAL_JOB_DAYS", 30),
      auditLogDays: this.configService.get<number>("RETENTION_AUDIT_LOG_DAYS", 180),
      securityAuditDays: this.configService.get<number>("RETENTION_SECURITY_AUDIT_DAYS", 365),
      uploadSessionDays: this.configService.get<number>("RETENTION_UPLOAD_SESSION_DAYS", 30),
      archiveEnabled: this.configService.get<boolean>("RETENTION_ARCHIVE_ENABLED", false),
      archiveBatchSize: this.configService.get<number>("RETENTION_ARCHIVE_BATCH_SIZE", 500)
    };
  }

  async runCleanup(input?: { reason?: RetentionReason; jobId?: string | null }): Promise<RetentionCleanupSummary> {
    const policy = this.getPolicy();
    const now = Date.now();

    const jobEventsBefore = new Date(now - policy.jobEventsDays * 24 * 60 * 60 * 1000);
    const failedJobsBefore = new Date(now - policy.failedJobDays * 24 * 60 * 60 * 1000);
    const terminalJobsBefore = new Date(now - policy.terminalJobDays * 24 * 60 * 60 * 1000);
    const auditLogsBefore = new Date(now - policy.auditLogDays * 24 * 60 * 60 * 1000);
    const securityAuditBefore = new Date(now - policy.securityAuditDays * 24 * 60 * 60 * 1000);
    const uploadSessionsBefore = new Date(now - policy.uploadSessionDays * 24 * 60 * 60 * 1000);

    const securityActionWhere: Prisma.AuditLogWhereInput[] = SECURITY_AUDIT_ACTION_PREFIXES.map((prefix) => ({
      action: {
        startsWith: prefix
      }
    }));

    const mode: RetentionCleanupSummary["mode"] = policy.archiveEnabled ? "archive_and_prune" : "hard_delete";

    const summary: RetentionCleanupSummary = {
      policy,
      mode,
      thresholds: {
        jobEventsBefore: jobEventsBefore.toISOString(),
        failedJobsBefore: failedJobsBefore.toISOString(),
        terminalJobsBefore: terminalJobsBefore.toISOString(),
        auditLogsBefore: auditLogsBefore.toISOString(),
        securityAuditBefore: securityAuditBefore.toISOString(),
        uploadSessionsBefore: uploadSessionsBefore.toISOString()
      },
      archived: {
        jobEventsCompletedCanceled: 0,
        jobEventsFailed: 0,
        auditLogsGeneral: 0,
        auditLogsSecurity: 0
      },
      deleted: {
        jobEventsCompletedCanceled: 0,
        jobEventsFailed: 0,
        auditLogsGeneral: 0,
        auditLogsSecurity: 0,
        jobsCompletedCanceled: 0,
        jobsFailed: 0,
        uploadSessions: 0
      }
    };

    try {
      const jobEventsCompletedCanceledWhere: Prisma.JobEventWhereInput = {
        createdAt: { lt: jobEventsBefore },
        job: {
          status: {
            in: ["COMPLETED", "CANCELED"]
          }
        }
      };

      const jobEventsFailedWhere: Prisma.JobEventWhereInput = {
        createdAt: { lt: failedJobsBefore },
        job: {
          status: "FAILED"
        }
      };

      const auditLogsGeneralWhere: Prisma.AuditLogWhereInput = {
        createdAt: { lt: auditLogsBefore },
        NOT: securityActionWhere
      };

      const auditLogsSecurityWhere: Prisma.AuditLogWhereInput = {
        createdAt: { lt: securityAuditBefore },
        OR: securityActionWhere
      };

      if (policy.archiveEnabled) {
        const jobEventsCompletedCanceled = await this.archiveAndDeleteJobEvents(jobEventsCompletedCanceledWhere, policy.archiveBatchSize);
        summary.archived.jobEventsCompletedCanceled = jobEventsCompletedCanceled.archived;
        summary.deleted.jobEventsCompletedCanceled = jobEventsCompletedCanceled.deleted;

        const jobEventsFailed = await this.archiveAndDeleteJobEvents(jobEventsFailedWhere, policy.archiveBatchSize);
        summary.archived.jobEventsFailed = jobEventsFailed.archived;
        summary.deleted.jobEventsFailed = jobEventsFailed.deleted;

        const auditLogsGeneral = await this.archiveAndDeleteAuditLogs(auditLogsGeneralWhere, policy.archiveBatchSize);
        summary.archived.auditLogsGeneral = auditLogsGeneral.archived;
        summary.deleted.auditLogsGeneral = auditLogsGeneral.deleted;

        const auditLogsSecurity = await this.archiveAndDeleteAuditLogs(auditLogsSecurityWhere, policy.archiveBatchSize);
        summary.archived.auditLogsSecurity = auditLogsSecurity.archived;
        summary.deleted.auditLogsSecurity = auditLogsSecurity.deleted;
      } else {
        const jobEventsCompletedCanceled = await this.prisma.jobEvent.deleteMany({ where: jobEventsCompletedCanceledWhere });
        summary.deleted.jobEventsCompletedCanceled = jobEventsCompletedCanceled.count;

        const jobEventsFailed = await this.prisma.jobEvent.deleteMany({ where: jobEventsFailedWhere });
        summary.deleted.jobEventsFailed = jobEventsFailed.count;

        const auditLogsGeneral = await this.prisma.auditLog.deleteMany({ where: auditLogsGeneralWhere });
        summary.deleted.auditLogsGeneral = auditLogsGeneral.count;

        const auditLogsSecurity = await this.prisma.auditLog.deleteMany({ where: auditLogsSecurityWhere });
        summary.deleted.auditLogsSecurity = auditLogsSecurity.count;
      }

      summary.deleted.jobsCompletedCanceled = await this.deleteTerminalJobs(["COMPLETED", "CANCELED"], terminalJobsBefore);
      summary.deleted.jobsFailed = await this.deleteTerminalJobs(["FAILED"], failedJobsBefore);

      const uploadSessions = await this.prisma.uploadSession.deleteMany({
        where: {
          status: {
            in: ["COMPLETED", "ABORTED", "FAILED"]
          },
          updatedAt: {
            lt: uploadSessionsBefore
          }
        }
      });
      summary.deleted.uploadSessions = uploadSessions.count;

      this.metricsService.recordRetentionCleanup("success");
      this.metricsService.recordRetentionDeleted("job_events", summary.deleted.jobEventsCompletedCanceled + summary.deleted.jobEventsFailed);
      this.metricsService.recordRetentionDeleted("audit_logs", summary.deleted.auditLogsGeneral + summary.deleted.auditLogsSecurity);
      this.metricsService.recordRetentionDeleted("jobs", summary.deleted.jobsCompletedCanceled + summary.deleted.jobsFailed);
      this.metricsService.recordRetentionDeleted("upload_sessions", summary.deleted.uploadSessions);
      this.metricsService.recordRetentionArchived("job_events", summary.archived.jobEventsCompletedCanceled + summary.archived.jobEventsFailed);
      this.metricsService.recordRetentionArchived("audit_logs", summary.archived.auditLogsGeneral + summary.archived.auditLogsSecurity);

      await this.setLastRunState({
        ranAt: new Date().toISOString(),
        status: "success",
        mode,
        reason: input?.reason ?? "manual",
        jobId: input?.jobId ?? null,
        error: null,
        archived: summary.archived,
        deleted: summary.deleted
      });

      return summary;
    } catch (error) {
      this.metricsService.recordRetentionCleanup("failure");
      await this.markLastRunFailure((error as Error).message, {
        mode,
        reason: input?.reason ?? "manual",
        jobId: input?.jobId ?? null
      });
      throw error;
    }
  }

  async getLastRunState(): Promise<RetentionLastRunState | null> {
    const item = await this.prisma.appSetting.findUnique({
      where: { key: RETENTION_LAST_RUN_KEY },
      select: { value: true }
    });

    if (!item?.value || typeof item.value !== "object" || Array.isArray(item.value)) {
      return null;
    }

    const value = item.value as Record<string, unknown>;
    return {
      ranAt: readString(value.ranAt) ?? new Date(0).toISOString(),
      status: readString(value.status) === "failure" ? "failure" : "success",
      mode: readString(value.mode) === "archive_and_prune" ? "archive_and_prune" : "hard_delete",
      reason: readString(value.reason) === "scheduled" ? "scheduled" : "manual",
      jobId: readString(value.jobId),
      error: readString(value.error),
      archived: readNumberRecord(value.archived),
      deleted: readNumberRecord(value.deleted)
    };
  }

  async markLastRunFailure(
    errorMessage: string,
    input?: { mode?: "hard_delete" | "archive_and_prune"; reason?: RetentionReason; jobId?: string | null }
  ): Promise<void> {
    try {
      await this.setLastRunState({
        ranAt: new Date().toISOString(),
        status: "failure",
        mode: input?.mode ?? (this.getPolicy().archiveEnabled ? "archive_and_prune" : "hard_delete"),
        reason: input?.reason ?? "manual",
        jobId: input?.jobId ?? null,
        error: errorMessage.slice(0, 2000),
        archived: {},
        deleted: {}
      });
    } catch (error) {
      this.logger.warn(`Failed to record retention last-run failure state: ${(error as Error).message}`);
    }
  }

  async getArchiveStats(): Promise<ArchiveStats> {
    const enabled = this.getPolicy().archiveEnabled;

    const [auditLogArchiveCount, jobEventArchiveCount, latestAudit, latestEvent] = await Promise.all([
      this.prisma.auditLogArchive.count(),
      this.prisma.jobEventArchive.count(),
      this.prisma.auditLogArchive.findFirst({
        orderBy: { archivedAt: "desc" },
        select: { archivedAt: true }
      }),
      this.prisma.jobEventArchive.findFirst({
        orderBy: { archivedAt: "desc" },
        select: { archivedAt: true }
      })
    ]);

    const lastArchivedAt = [latestAudit?.archivedAt, latestEvent?.archivedAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null;

    return {
      enabled,
      auditLogArchiveCount,
      jobEventArchiveCount,
      lastArchivedAt
    };
  }

  private async archiveAndDeleteJobEvents(
    where: Prisma.JobEventWhereInput,
    batchSize: number
  ): Promise<{ archived: number; deleted: number }> {
    let archived = 0;
    let deleted = 0;

    while (true) {
      const rows = await this.prisma.jobEvent.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: batchSize,
        include: {
          job: {
            select: {
              type: true,
              status: true
            }
          }
        }
      });

      if (rows.length === 0) {
        break;
      }

      const ids = rows.map((row) => row.id);

      await this.prisma.$transaction(async (tx) => {
        await tx.jobEventArchive.createMany({
          data: rows.map((row) => ({
            sourceJobEventId: row.id,
            jobId: row.jobId,
            jobType: row.job.type,
            jobStatus: row.job.status,
            correlationId: row.correlationId,
            type: row.type,
            level: row.level,
            message: row.message,
            metadata: toArchiveJsonValue(row.metadata),
            createdAt: row.createdAt
          })),
          skipDuplicates: true
        });

        await tx.jobEvent.deleteMany({
          where: {
            id: {
              in: ids
            }
          }
        });
      });

      archived += rows.length;
      deleted += rows.length;
    }

    return { archived, deleted };
  }

  private async archiveAndDeleteAuditLogs(
    where: Prisma.AuditLogWhereInput,
    batchSize: number
  ): Promise<{ archived: number; deleted: number }> {
    let archived = 0;
    let deleted = 0;

    while (true) {
      const rows = await this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: batchSize
      });

      if (rows.length === 0) {
        break;
      }

      const ids = rows.map((row) => row.id);

      await this.prisma.$transaction(async (tx) => {
        await tx.auditLogArchive.createMany({
          data: rows.map((row) => ({
            sourceAuditLogId: row.id,
            actorUserId: row.actorUserId,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            metadata: toArchiveJsonValue(row.metadata),
            ipAddress: row.ipAddress,
            createdAt: row.createdAt
          })),
          skipDuplicates: true
        });

        await tx.auditLog.deleteMany({
          where: {
            id: {
              in: ids
            }
          }
        });
      });

      archived += rows.length;
      deleted += rows.length;
    }

    return { archived, deleted };
  }

  private async deleteTerminalJobs(statuses: JobStatus[], threshold: Date): Promise<number> {
    const deleted = await this.prisma.job.deleteMany({
      where: {
        status: {
          in: statuses
        },
        completedAt: {
          lt: threshold
        }
      }
    });

    return deleted.count;
  }

  private async setLastRunState(value: RetentionLastRunState): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: {
        key: RETENTION_LAST_RUN_KEY
      },
      create: {
        key: RETENTION_LAST_RUN_KEY,
        value: value as unknown as Prisma.InputJsonValue
      },
      update: {
        value: value as unknown as Prisma.InputJsonValue
      }
    });
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      result[key] = raw;
    }
  }
  return result;
}

function toArchiveJsonValue(
  value: Prisma.JsonValue | null
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
}
