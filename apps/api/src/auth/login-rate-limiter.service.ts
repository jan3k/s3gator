import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface AttemptState {
  firstAt: number;
  count: number;
}

@Injectable()
export class LoginRateLimiterService {
  private readonly states = new Map<string, AttemptState>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(configService: ConfigService) {
    this.maxAttempts = configService.get<number>("LOGIN_MAX_ATTEMPTS", 8);
    this.windowMs = configService.get<number>("LOGIN_WINDOW_SECONDS", 300) * 1000;
  }

  check(key: string): void {
    const now = Date.now();
    const state = this.states.get(key);

    if (!state) {
      return;
    }

    if (now - state.firstAt > this.windowMs) {
      this.states.delete(key);
      return;
    }

    if (state.count >= this.maxAttempts) {
      throw new HttpException("Too many login attempts. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  registerFailure(key: string): void {
    const now = Date.now();
    const state = this.states.get(key);

    if (!state || now - state.firstAt > this.windowMs) {
      this.states.set(key, { firstAt: now, count: 1 });
      return;
    }

    state.count += 1;
    this.states.set(key, state);
  }

  clear(key: string): void {
    this.states.delete(key);
  }
}
