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
const SCHEDULER_HEARTBEAT_KEY = "maintenance.scheduler.heartbeat";

export type SchedulerTaskKey = "retention_cleanup" | "upload_cleanup" | "bucket_sync";
type SchedulerTrigger = "scheduled" | "manual";
type SchedulerResult = "queued" | "skipped_active" | "failed" | "skipped_disabled";

interface SchedulerTaskDefinition {
  key: SchedulerTaskKey;
  jobType: JobType;
  intervalMinutes: number;
  enabled: boolean;
}

interface StoredSchedulerTaskState {
  task: SchedulerTaskKey;
  ranAt: string;
  nextRunAt: string | null;
  result: SchedulerResult;
  trigger: SchedulerTrigger;
  taskEnabled: boolean;
  intervalMinutes: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastHeartbeatAt: string | null;
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
  lastTrigger: SchedulerTrigger | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastHeartbeatAt: string | null;
  lastJobId: string | null;
  lastError: string | null;
}

export interface MaintenanceSchedulerStatus {
  enabled: boolean;
  tickSeconds: number;
  lockTtlSeconds: number;
  lastHeartbeatAt: string | null;
  tasks: SchedulerTaskStatus[];
}

export interface SchedulerRunTaskResult {
  task: SchedulerTaskKey;
  result: SchedulerResult;
  jobId: string | null;
  error: string | null;
  nextRunAt: string | null;
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
    this.lockTtlSeconds = this.resolveLockTtlSeconds(
      this.configService.get<number>("MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS", 60),
      this.tickSeconds
    );
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

  async runTaskNow(taskKey: SchedulerTaskKey, actor: SessionUser, correlationId?: string): Promise<SchedulerRunTaskResult> {
    const tasks = this.getTaskDefinitions();
    const task = tasks.find((item) => item.key === taskKey);

    if (!task) {
      return {
        task: taskKey,
        result: "failed",
        jobId: null,
        error: "Unknown maintenance task.",
        nextRunAt: null
      };
    }

    const now = new Date();
    const runCorrelationId = correlationId ?? `${this.instanceId}-manual-${Date.now()}`;
    const lockValue = `${this.instanceId}:manual:${taskKey}:${Date.now()}`;

    const acquired = await this.redisService.acquireLock(this.lockKey, lockValue, this.lockTtlSeconds);
    if (!acquired) {
      return {
        task: task.key,
        result: "failed",
        jobId: null,
        error: "Scheduler lock is busy. Try again shortly.",
        nextRunAt: null
      };
    }

    try {
      const result = await runWithRequestContext(
        {
          requestId: runCorrelationId,
          correlationId: runCorrelationId,
          source: "script",
          userId: actor.id
        },
        async () => this.executeTask(task, now, actor, runCorrelationId, "manual")
      );

      await this.auditService.record({
        actor,
        action: "maintenance.scheduler.run_once",
        entityType: "maintenance_task",
        entityId: task.key,
        metadata: {
          task: task.key,
          result: result.result,
          jobId: result.jobId,
          error: result.error,
          reason: "manual",
          correlationId: runCorrelationId
        }
      });

      return result;
    } finally {
      await this.redisService.releaseLock(this.lockKey, lockValue).catch(() => undefined);
    }
  }

  async getStatus(): Promise<MaintenanceSchedulerStatus> {
    const tasks = this.getTaskDefinitions();
    const [states, heartbeat] = await Promise.all([
      Promise.all(tasks.map((task) => this.readTaskState(task.key))),
      this.readHeartbeat()
    ]);

    return {
      enabled: this.enabled,
      tickSeconds: this.tickSeconds,
      lockTtlSeconds: this.lockTtlSeconds,
      lastHeartbeatAt: heartbeat,
      tasks: tasks.map((task, index) => {
        const state = states[index];
        return {
          task: task.key,
          enabled: this.isScheduledTaskEnabled(task),
          intervalMinutes: task.intervalMinutes,
          lastRunAt: state?.ranAt ?? null,
          nextRunAt: state?.nextRunAt ?? null,
          lastResult: state?.result ?? null,
          lastTrigger: state?.trigger ?? null,
          lastSuccessAt: state?.lastSuccessAt ?? null,
          lastFailureAt: state?.lastFailureAt ?? null,
          lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
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
          await this.writeHeartbeat(now);

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
    if (!this.isScheduledTaskEnabled(task)) {
      const existing = await this.readTaskState(task.key);
      if (
        existing?.result === "skipped_disabled" &&
        existing.taskEnabled === false &&
        existing.intervalMinutes === task.intervalMinutes
      ) {
        return;
      }

      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt: null,
        result: "skipped_disabled",
        trigger: "scheduled",
        taskEnabled: false,
        intervalMinutes: task.intervalMinutes,
        lastJobId: null,
        error: null,
        heartbeatAt: now.toISOString()
      });
      return;
    }

    const currentState = await this.readTaskState(task.key);
    const nextRunFromState = currentState?.nextRunAt ? new Date(currentState.nextRunAt) : null;

    if (nextRunFromState && nextRunFromState.getTime() > now.getTime()) {
      return;
    }

    await this.executeTask(task, now, actor, correlationId, "scheduled");
  }

  private async executeTask(
    task: SchedulerTaskDefinition,
    now: Date,
    actor: SessionUser | null,
    correlationId: string,
    trigger: SchedulerTrigger
  ): Promise<SchedulerRunTaskResult> {
    const nextRunAt = this.computeNextRunAt(task, now, trigger);

    if (!task.enabled) {
      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "skipped_disabled",
        trigger,
        taskEnabled: false,
        intervalMinutes: task.intervalMinutes,
        lastJobId: null,
        error: null,
        heartbeatAt: now.toISOString()
      });

      return {
        task: task.key,
        result: "skipped_disabled",
        jobId: null,
        error: null,
        nextRunAt
      };
    }

    if (!actor) {
      const message = "No active SUPER_ADMIN or ADMIN user available for maintenance actor.";
      this.metricsService.recordSchedulerRun(task.key, "failed");
      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "failed",
        trigger,
        taskEnabled: task.enabled,
        intervalMinutes: task.intervalMinutes,
        lastJobId: null,
        error: message,
        heartbeatAt: now.toISOString()
      });
      this.logger.warn(`Scheduler task ${task.key} failed: ${message}`);
      return {
        task: task.key,
        result: "failed",
        jobId: null,
        error: message,
        nextRunAt
      };
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
        trigger,
        taskEnabled: task.enabled,
        intervalMinutes: task.intervalMinutes,
        lastJobId: active.id,
        error: null,
        heartbeatAt: now.toISOString()
      });

      return {
        task: task.key,
        result: "skipped_active",
        jobId: active.id,
        error: null,
        nextRunAt
      };
    }

    try {
      const job = await this.enqueueTask(task, actor, correlationId, trigger);
      this.metricsService.recordSchedulerRun(task.key, "queued");

      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "queued",
        trigger,
        taskEnabled: task.enabled,
        intervalMinutes: task.intervalMinutes,
        lastJobId: job.id,
        error: null,
        heartbeatAt: now.toISOString()
      });

      await this.auditService.record({
        actor,
        action: "maintenance.scheduler.enqueue",
        entityType: "job",
        entityId: job.id,
        metadata: {
          task: task.key,
          reason: trigger,
          correlationId,
          intervalMinutes: task.intervalMinutes
        }
      });

      return {
        task: task.key,
        result: "queued",
        jobId: job.id,
        error: null,
        nextRunAt
      };
    } catch (error) {
      const message = (error as Error).message.slice(0, 2000);
      this.metricsService.recordSchedulerRun(task.key, "failed");

      await this.writeTaskState({
        task: task.key,
        ranAt: now.toISOString(),
        nextRunAt,
        result: "failed",
        trigger,
        taskEnabled: task.enabled,
        intervalMinutes: task.intervalMinutes,
        lastJobId: null,
        error: message,
        heartbeatAt: now.toISOString()
      });
      this.logger.warn(`Scheduler task ${task.key} failed: ${message}`);

      return {
        task: task.key,
        result: "failed",
        jobId: null,
        error: message,
        nextRunAt
      };
    }
  }

  private async enqueueTask(
    task: SchedulerTaskDefinition,
    actor: SessionUser,
    correlationId: string,
    trigger: SchedulerTrigger
  ): Promise<{ id: string }> {
    if (task.key === "retention_cleanup") {
      return this.jobsService.enqueueRetentionCleanup({
        actor,
        reason: trigger,
        correlationId
      });
    }

    if (task.key === "upload_cleanup") {
      return this.jobsService.enqueueUploadCleanup({
        actor,
        reason: trigger,
        correlationId
      });
    }

    return this.jobsService.enqueueBucketSync({
      actor,
      reason: trigger,
      correlationId
    });
  }

  private getTaskDefinitions(): SchedulerTaskDefinition[] {
    const tasks: SchedulerTaskDefinition[] = [
      {
        key: "retention_cleanup",
        jobType: "RETENTION_CLEANUP",
        enabled: this.configService.get<boolean>("MAINTENANCE_TASK_RETENTION_ENABLED", true),
        intervalMinutes: this.configService.get<number>("MAINTENANCE_RETENTION_INTERVAL_MINUTES", 360)
      },
      {
        key: "upload_cleanup",
        jobType: "UPLOAD_CLEANUP",
        enabled: this.configService.get<boolean>("MAINTENANCE_TASK_UPLOAD_CLEANUP_ENABLED", true),
        intervalMinutes: this.configService.get<number>("MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES", 30)
      },
      {
        key: "bucket_sync",
        jobType: "BUCKET_SYNC",
        enabled: this.configService.get<boolean>("MAINTENANCE_TASK_BUCKET_SYNC_ENABLED", false),
        intervalMinutes: this.configService.get<number>("MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES", 0)
      }
    ];

    return tasks.map((task) => ({
      ...task,
      intervalMinutes: Number.isFinite(task.intervalMinutes) && task.intervalMinutes > 0 ? task.intervalMinutes : 0
    }));
  }

  private isScheduledTaskEnabled(task: SchedulerTaskDefinition): boolean {
    return this.enabled && task.enabled && task.intervalMinutes > 0;
  }

  private computeNextRunAt(task: SchedulerTaskDefinition, now: Date, trigger: SchedulerTrigger): string | null {
    if (!task.enabled || task.intervalMinutes <= 0) {
      return null;
    }

    if (trigger === "scheduled" || this.isScheduledTaskEnabled(task)) {
      return new Date(now.getTime() + task.intervalMinutes * 60 * 1000).toISOString();
    }

    return null;
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
    const trigger = readSchedulerTrigger(value.trigger);

    if (!result || !ranAt || !trigger) {
      return null;
    }

    return {
      task,
      ranAt,
      nextRunAt: readString(value.nextRunAt),
      result,
      trigger,
      taskEnabled: readBoolean(value.taskEnabled) ?? false,
      intervalMinutes: readNumber(value.intervalMinutes) ?? 0,
      lastSuccessAt: readString(value.lastSuccessAt),
      lastFailureAt: readString(value.lastFailureAt),
      lastHeartbeatAt: readString(value.lastHeartbeatAt),
      lastJobId: readString(value.lastJobId),
      error: readString(value.error)
    };
  }

  private async writeTaskState(state: {
    task: SchedulerTaskKey;
    ranAt: string;
    nextRunAt: string | null;
    result: SchedulerResult;
    trigger: SchedulerTrigger;
    taskEnabled: boolean;
    intervalMinutes: number;
    lastJobId: string | null;
    error: string | null;
    heartbeatAt: string;
  }): Promise<void> {
    const previous = await this.readTaskState(state.task);

    const value = {
      ranAt: state.ranAt,
      nextRunAt: state.nextRunAt,
      result: state.result,
      trigger: state.trigger,
      taskEnabled: state.taskEnabled,
      intervalMinutes: state.intervalMinutes,
      lastSuccessAt: state.result === "queued" ? state.ranAt : previous?.lastSuccessAt ?? null,
      lastFailureAt: state.result === "failed" ? state.ranAt : previous?.lastFailureAt ?? null,
      lastHeartbeatAt: state.heartbeatAt,
      lastJobId: state.lastJobId,
      error: state.error
    };

    await this.prisma.appSetting.upsert({
      where: {
        key: `${SCHEDULER_STATE_PREFIX}${state.task}`
      },
      create: {
        key: `${SCHEDULER_STATE_PREFIX}${state.task}`,
        value
      },
      update: {
        value
      }
    });
  }

  private async writeHeartbeat(now: Date): Promise<void> {
    const value = now.toISOString();

    await this.prisma.appSetting.upsert({
      where: {
        key: SCHEDULER_HEARTBEAT_KEY
      },
      create: {
        key: SCHEDULER_HEARTBEAT_KEY,
        value
      },
      update: {
        value
      }
    });
  }

  private async readHeartbeat(): Promise<string | null> {
    const item = await this.prisma.appSetting.findUnique({
      where: {
        key: SCHEDULER_HEARTBEAT_KEY
      },
      select: {
        value: true
      }
    });

    return readString(item?.value);
  }

  private resolveLockTtlSeconds(configured: number, tickSeconds: number): number {
    const minLockTtl = tickSeconds + 5;
    if (configured >= minLockTtl) {
      return configured;
    }

    this.logger.warn(
      `MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS (${configured}) is lower than tick+5 (${minLockTtl}); using ${minLockTtl}`
    );
    return minLockTtl;
  }
}

function readSchedulerResult(value: unknown): SchedulerResult | null {
  if (value === "queued" || value === "skipped_active" || value === "failed" || value === "skipped_disabled") {
    return value;
  }
  return null;
}

function readSchedulerTrigger(value: unknown): SchedulerTrigger | null {
  if (value === "scheduled" || value === "manual") {
    return value;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
