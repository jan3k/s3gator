import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type JobType } from "@prisma/client";
import type { SessionUser } from "@s3gator/shared";
import { AuditService } from "@/audit/audit.service.js";
import { runWithRequestContext } from "@/common/request-context.js";
import { MetricsService } from "@/metrics/metrics.service.js";
import { PrismaService } from "@/prisma/prisma.service.js";
import { RedisService } from "@/redis/redis.service.js";
import { JobsService } from "./jobs.service.js";

const SCHEDULER_STATE_PREFIX = "maintenance.scheduler.task.";

type SchedulerTaskKey = "retention_cleanup" | "upload_cleanup" | "bucket_sync";
type SchedulerResult = "queued" | "skipped_active" | "failed";

interface SchedulerTaskDefinition {
  key: SchedulerTaskKey;
  jobType: JobType;
  intervalMinutes: number;
}

interface StoredSchedulerTaskState {
  task: SchedulerTaskKey;
  ranAt: string;
  nextRunAt: string | null;
  result: SchedulerResult;
  lastJobId: string | null;
  error: string | null;
}

export interface SchedulerTaskStatus {
  task: SchedulerTaskKey;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: SchedulerResult | null;
  lastJobId: string | null;
  lastError: string | null;
}

export interface MaintenanceSchedulerStatus {
  enabled: boolean;
  tickSeconds: number;
  lockTtlSeconds: number;
  tasks: SchedulerTaskStatus[];
}

@Injectable()
export class MaintenanceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceSchedulerService.name);
  private readonly enabled: boolean;
  private readonly tickSeconds: number;
  private readonly lockTtlSeconds: number;
  private readonly lockKey: string;
  private readonly instanceId: string;

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly jobsService: JobsService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {
    this.enabled = this.configService.get<boolean>("MAINTENANCE_SCHEDULER_ENABLED", false);
    this.tickSeconds = this.configService.get<number>("MAINTENANCE_SCHEDULER_TICK_SECONDS", 30);
    this.lockTtlSeconds = this.configService.get<number>("MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS", 60);
    this.lockKey = this.redisService.key("maintenance:scheduler:tick");
    this.instanceId = `scheduler-${process.pid}`;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.logger.log(
      `Starting maintenance scheduler (tick=${this.tickSeconds}s, lockTtl=${this.lockTtlSeconds}s)`
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickSeconds * 1000);
    this.timer.unref?.();

    await this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    await this.tick();
  }

  async getStatus(): Promise<MaintenanceSchedulerStatus> {
    const tasks = this.getTaskDefinitions();
    const states = await Promise.all(tasks.map((task) => this.readTaskState(task.key)));

    return {
      enabled: this.enabled,
      tickSeconds: this.tickSeconds,
      lockTtlSeconds: this.lockTtlSeconds,
      tasks: tasks.map((task, index) => {
        const state = states[index];
        return {
          task: task.key,
          enabled: this.enabled && task.intervalMinutes > 0,
          intervalMinutes: task.intervalMinutes,
          lastRunAt: state?.ranAt ?? null,
          nextRunAt: state?.nextRunAt ?? null,
          lastResult: state?.result ?? null,
          lastJobId: state?.lastJobId ?? null,
          lastError: state?.error ?? null
        } satisfies SchedulerTaskStatus;
      })
    };
  }

  private async tick(): Promise<void> {
    if (!this.enabled || this.running) {
      return;
    }

    this.running = true;
    const lockValue = `${this.instanceId}:${Date.now()}`;

    try {
      const acquired = await this.redisService.acquireLock(this.lockKey, lockValue, this.lockTtlSeconds);
      if (!acquired) {
        return;
      }

      const correlationId = `${this.instanceId}-${Date.now()}`;
      await runWithRequestContext(
        {
          requestId: correlationId,
          correlationId,
          source: "script"
        },
        async () => {
          const actor = await this.resolveSchedulerActor();
          const now = new Date();
          for (const task of this.getTaskDefinitions()) {
            await this.executeTaskIfDue(task, now, actor, correlationId);
          }
        }
      );
    } catch (error) {
      this.logger.error(`Maintenance scheduler tick failed: ${(error as Error).message}`);
    } finally {
      await this.redisService.releaseLock(this.lockKey, lockValue).catch(() => undefined);
      this.running = false;
    }
  }

  private async executeTaskIfDue(
    task: SchedulerTaskDefinition,
    now: Date,
    actor: SessionUser | null,
    correlationId: string
  ): Promise<void> {
    if (task.intervalMinutes <= 0) {
      return;
    }

    const currentState = await this.readTaskState(task.key);
    const nextRunFromState = currentState?.nextRunAt ? new Date(currentState.nextRunAt) : null;

    if (nextRunFromState && nextRunFromState.getTime() > now.getTime()) {
      return;
    }

    const nextRunAt = new Date(now.getTime() + task.intervalMinutes * 60 * 1000).toISOString();

    if (!actor) {
      const message = "No active SUPER_ADMIN or ADMIN user available for scheduled maintenance actor.";
      this.metricsService.recordSchedulerRun(task.key, "failed");
      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "failed",
        lastJobId: null,
        error: message
      });
      this.logger.warn(`Scheduler task ${task.key} failed: ${message}`);
      return;
    }

    const active = await this.prisma.job.findFirst({
      where: {
        type: task.jobType,
        status: {
          in: ["QUEUED", "RUNNING"]
        }
      },
      select: { id: true }
    });

    if (active) {
      this.metricsService.recordSchedulerRun(task.key, "skipped_active");
      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "skipped_active",
        lastJobId: active.id,
        error: null
      });
      return;
    }

    try {
      const job = await this.enqueueScheduledTask(task, actor, correlationId);
      this.metricsService.recordSchedulerRun(task.key, "queued");

      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "queued",
        lastJobId: job.id,
        error: null
      });

      await this.auditService.record({
        actor,
        action: "maintenance.scheduler.enqueue",
        entityType: "job",
        entityId: job.id,
        metadata: {
          task: task.key,
          reason: "scheduled",
          correlationId,
          intervalMinutes: task.intervalMinutes
        }
      });
    } catch (error) {
      const message = (error as Error).message.slice(0, 2000);
      this.metricsService.recordSchedulerRun(task.key, "failed");

      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "failed",
        lastJobId: null,
        error: message
      });
      this.logger.warn(`Scheduler task ${task.key} failed: ${message}`);
    }
  }

  private async enqueueScheduledTask(
    task: SchedulerTaskDefinition,
    actor: SessionUser,
    correlationId: string
  ): Promise<{ id: string }> {
    if (task.key === "retention_cleanup") {
      return this.jobsService.enqueueRetentionCleanup({
        actor,
        reason: "scheduled",
        correlationId
      });
    }

    if (task.key === "upload_cleanup") {
      return this.jobsService.enqueueUploadCleanup({
        actor,
        reason: "scheduled",
        correlationId
      });
    }

    return this.jobsService.enqueueBucketSync({
      actor,
      reason: "scheduled",
      correlationId
    });
  }

  private getTaskDefinitions(): SchedulerTaskDefinition[] {
    return [
      {
        key: "retention_cleanup",
        jobType: "RETENTION_CLEANUP",
        intervalMinutes: this.configService.get<number>("MAINTENANCE_RETENTION_INTERVAL_MINUTES", 360)
      },
      {
        key: "upload_cleanup",
        jobType: "UPLOAD_CLEANUP",
        intervalMinutes: this.configService.get<number>("MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES", 30)
      },
      {
        key: "bucket_sync",
        jobType: "BUCKET_SYNC",
        intervalMinutes: this.configService.get<number>("MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES", 0)
      }
    ];
  }

  private async resolveSchedulerActor(): Promise<SessionUser | null> {
    const user =
      (await this.prisma.user.findFirst({
        where: {
          isActive: true,
          role: {
            code: "SUPER_ADMIN"
          }
        },
        include: {
          role: true
        },
        orderBy: {
          createdAt: "asc"
        }
      })) ??
      (await this.prisma.user.findFirst({
        where: {
          isActive: true,
          role: {
            code: "ADMIN"
          }
        },
        include: {
          role: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }));

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role.code
    };
  }

  private async readTaskState(task: SchedulerTaskKey): Promise<StoredSchedulerTaskState | null> {
    const item = await this.prisma.appSetting.findUnique({
      where: { key: `${SCHEDULER_STATE_PREFIX}${task}` },
      select: { value: true }
    });

    if (!item?.value || typeof item.value !== "object" || Array.isArray(item.value)) {
      return null;
    }

    const value = item.value as Record<string, unknown>;
    const result = readSchedulerResult(value.result);
    const ranAt = readString(value.ranAt);

    if (!result || !ranAt) {
      return null;
    }

    return {
      task,
      ranAt,
      nextRunAt: readString(value.nextRunAt),
      result,
      lastJobId: readString(value.lastJobId),
      error: readString(value.error)
    };
  }

  private async writeTaskState(state: StoredSchedulerTaskState): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: {
        key: `${SCHEDULER_STATE_PREFIX}${state.task}`
      },
      create: {
        key: `${SCHEDULER_STATE_PREFIX}${state.task}`,
        value: {
          ranAt: state.ranAt,
          nextRunAt: state.nextRunAt,
          result: state.result,
          lastJobId: state.lastJobId,
          error: state.error
        }
      },
      update: {
        value: {
          ranAt: state.ranAt,
          nextRunAt: state.nextRunAt,
          result: state.result,
          lastJobId: state.lastJobId,
          error: state.error
        }
      }
    });
  }
}

function readSchedulerResult(value: unknown): SchedulerResult | null {
  if (value === "queued" || value === "skipped_active" || value === "failed") {
    return value;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
