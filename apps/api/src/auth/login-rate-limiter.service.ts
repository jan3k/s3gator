import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "@/redis/redis.service.js";

@Injectable()
export class LoginRateLimiterService {
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;

  constructor(
    configService: ConfigService,
    private readonly redisService: RedisService
  ) {
    this.maxAttempts = configService.get<number>("LOGIN_MAX_ATTEMPTS", 8);
    this.windowSeconds = configService.get<number>("LOGIN_WINDOW_SECONDS", 300);
  }

  async check(key: string): Promise<void> {
    const countRaw = await this.redisService.get(this.toStorageKey(key));
    if (!countRaw) {
      return;
    }

    const count = Number(countRaw);

    if (count >= this.maxAttempts) {
      throw new HttpException("Too many login attempts. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async registerFailure(key: string): Promise<void> {
    await this.redisService.incrementWithWindow(this.toStorageKey(key), this.windowSeconds);
  }

  async clear(key: string): Promise<void> {
    await this.redisService.delete(this.toStorageKey(key));
  }

  private toStorageKey(key: string): string {
    return this.redisService.key(`login:${key}`);
  }
}
