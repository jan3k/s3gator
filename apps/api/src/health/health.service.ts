import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/prisma/prisma.service.js";
import { RedisService } from "@/redis/redis.service.js";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService
  ) {}

  async liveness() {
    return {
      status: "ok",
      service: "s3gator-api",
      now: new Date().toISOString()
    };
  }

  async readiness() {
    const checks = {
      database: false,
      redis: false
    };

    await this.prisma.$queryRaw`SELECT 1`;
    checks.database = true;

    checks.redis = await this.redisService.ping();

    return {
      status: checks.database && checks.redis ? "ready" : "degraded",
      checks,
      now: new Date().toISOString()
    };
  }
}
