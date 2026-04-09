import { Injectable } from "@nestjs/common";
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

export interface RetentionPolicy {
  jobEventsDays: number;
  failedJobDays: number;
  terminalJobDays: number;
  auditLogDays: number;
  securityAuditDays: number;
  uploadSessionDays: number;
}

export interface RetentionCleanupSummary {
  policy: RetentionPolicy;
  thresholds: {
    jobEventsBefore: string;
    failedJobsBefore: string;
    terminalJobsBefore: string;
    auditLogsBefore: string;
    securityAuditBefore: string;
    uploadSessionsBefore: string;
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

@Injectable()
export class JobRetentionService {
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
      uploadSessionDays: this.configService.get<number>("RETENTION_UPLOAD_SESSION_DAYS", 30)
    };
  }

  async runCleanup(): Promise<RetentionCleanupSummary> {
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

    const jobEventsCompletedCanceled = await this.prisma.jobEvent.deleteMany({
      where: {
        createdAt: { lt: jobEventsBefore },
        job: {
          status: {
            in: ["COMPLETED", "CANCELED"]
          }
        }
      }
    });

    const jobEventsFailed = await this.prisma.jobEvent.deleteMany({
      where: {
        createdAt: { lt: failedJobsBefore },
        job: {
          status: "FAILED"
        }
      }
    });

    const auditLogsGeneral = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: auditLogsBefore },
        NOT: securityActionWhere
      }
    });

    const auditLogsSecurity = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: securityAuditBefore },
        OR: securityActionWhere
      }
    });

    const jobsCompletedCanceled = await this.deleteTerminalJobs(["COMPLETED", "CANCELED"], terminalJobsBefore);
    const jobsFailed = await this.deleteTerminalJobs(["FAILED"], failedJobsBefore);

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

    this.metricsService.recordRetentionCleanup("success");
    this.metricsService.recordRetentionDeleted("job_events", jobEventsCompletedCanceled.count + jobEventsFailed.count);
    this.metricsService.recordRetentionDeleted("audit_logs", auditLogsGeneral.count + auditLogsSecurity.count);
    this.metricsService.recordRetentionDeleted("jobs", jobsCompletedCanceled + jobsFailed);
    this.metricsService.recordRetentionDeleted("upload_sessions", uploadSessions.count);

    return {
      policy,
      thresholds: {
        jobEventsBefore: jobEventsBefore.toISOString(),
        failedJobsBefore: failedJobsBefore.toISOString(),
        terminalJobsBefore: terminalJobsBefore.toISOString(),
        auditLogsBefore: auditLogsBefore.toISOString(),
        securityAuditBefore: securityAuditBefore.toISOString(),
        uploadSessionsBefore: uploadSessionsBefore.toISOString()
      },
      deleted: {
        jobEventsCompletedCanceled: jobEventsCompletedCanceled.count,
        jobEventsFailed: jobEventsFailed.count,
        auditLogsGeneral: auditLogsGeneral.count,
        auditLogsSecurity: auditLogsSecurity.count,
        jobsCompletedCanceled,
        jobsFailed,
        uploadSessions: uploadSessions.count
      }
    };
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
}
