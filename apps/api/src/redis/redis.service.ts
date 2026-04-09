import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis as RedisClient } from "ioredis";

interface MemoryCounterState {
  count: number;
  expiresAt: number;
}

interface MemoryLockState {
  value: string;
  expiresAt: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly enabled: boolean;
  private readonly prefix: string;
  private readonly client?: RedisClient;

  private readonly memoryCounters = new Map<string, MemoryCounterState>();
  private readonly memoryLocks = new Map<string, MemoryLockState>();

  constructor(private readonly configService: ConfigService) {
    const nodeEnv = this.configService.get<string>("NODE_ENV", "development");
    this.enabled = this.configService.get<boolean>("REDIS_ENABLED", nodeEnv !== "test");
    this.prefix = this.configService.get<string>("REDIS_PREFIX", "s3gator");

    if (this.enabled) {
      this.client = new RedisClient(this.configService.get<string>("REDIS_URL", "redis://127.0.0.1:6379"), {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.warn("Redis disabled; using process-local fallback for limiter/locks");
      return;
    }

    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.quit().catch(() => undefined);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  key(suffix: string): string {
    return `${this.prefix}:${suffix}`;
  }

  async ping(): Promise<boolean> {
    if (!this.enabled || !this.client) {
      return true;
    }

    return (await this.client.ping()) === "PONG";
  }

  async incrementWithWindow(key: string, windowSeconds: number): Promise<number> {
    if (!this.enabled || !this.client) {
      this.cleanupMemory();
      const now = Date.now();
      const state = this.memoryCounters.get(key);
      if (!state || state.expiresAt <= now) {
        this.memoryCounters.set(key, {
          count: 1,
          expiresAt: now + windowSeconds * 1000
        });
        return 1;
      }

      state.count += 1;
      this.memoryCounters.set(key, state);
      return state.count;
    }

    const multi = this.client.multi();
    multi.incr(key);
    multi.expire(key, windowSeconds, "NX");
    const result = await multi.exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    return count;
  }

  async get(key: string): Promise<string | null> {
    if (!this.enabled || !this.client) {
      this.cleanupMemory();
      const counter = this.memoryCounters.get(key);
      if (counter) {
        return String(counter.count);
      }

      const lock = this.memoryLocks.get(key);
      return lock?.value ?? null;
    }

    return this.client.get(key);
  }

  async delete(key: string): Promise<void> {
    if (!this.enabled || !this.client) {
      this.memoryCounters.delete(key);
      this.memoryLocks.delete(key);
      return;
    }

    await this.client.del(key);
  }

  async acquireLock(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.enabled || !this.client) {
      this.cleanupMemory();
      const now = Date.now();
      const existing = this.memoryLocks.get(key);
      if (existing && existing.expiresAt > now) {
        return false;
      }

      this.memoryLocks.set(key, {
        value,
        expiresAt: now + ttlSeconds * 1000
      });
      return true;
    }

    const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async releaseLock(key: string, value: string): Promise<boolean> {
    if (!this.enabled || !this.client) {
      this.cleanupMemory();
      const existing = this.memoryLocks.get(key);
      if (!existing || existing.value !== value) {
        return false;
      }

      this.memoryLocks.delete(key);
      return true;
    }

    const result = await this.client.eval(
      [
        "if redis.call('get', KEYS[1]) == ARGV[1] then",
        "  return redis.call('del', KEYS[1])",
        "end",
        "return 0"
      ].join("\n"),
      1,
      key,
      value
    );

    return Number(result) === 1;
  }

  private cleanupMemory(): void {
    const now = Date.now();

    for (const [key, state] of this.memoryCounters.entries()) {
      if (state.expiresAt <= now) {
        this.memoryCounters.delete(key);
      }
    }

    for (const [key, state] of this.memoryLocks.entries()) {
      if (state.expiresAt <= now) {
        this.memoryLocks.delete(key);
      }
    }
  }
}
