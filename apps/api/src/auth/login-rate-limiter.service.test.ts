import { describe, expect, it } from "vitest";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";

function config(max: number, windowSec: number) {
  return {
    get: (key: string, fallback: number) => {
      if (key === "LOGIN_MAX_ATTEMPTS") {
        return max;
      }
      if (key === "LOGIN_WINDOW_SECONDS") {
        return windowSec;
      }
      return fallback;
    }
  } as const;
}

describe("LoginRateLimiterService", () => {
  const redis = {
    key: (value: string) => value,
    get: async (key: string) => inMemory.get(key) ?? null,
    incrementWithWindow: async (key: string) => {
      const next = Number(inMemory.get(key) ?? "0") + 1;
      inMemory.set(key, String(next));
      return next;
    },
    delete: async (key: string) => {
      inMemory.delete(key);
    }
  };

  const inMemory = new Map<string, string>();

  it("blocks after max attempts", async () => {
    inMemory.clear();
    const service = new LoginRateLimiterService(config(2, 300) as never, redis as never);

    await service.check("k");
    await service.registerFailure("k");
    await service.check("k");
    await service.registerFailure("k");

    await expect(service.check("k")).rejects.toThrowError(/Too many login attempts/i);
  });

  it("clears attempt state", async () => {
    inMemory.clear();
    const service = new LoginRateLimiterService(config(1, 300) as never, redis as never);

    await service.registerFailure("k");
    await expect(service.check("k")).rejects.toThrow();

    await service.clear("k");
    await expect(service.check("k")).resolves.toBeUndefined();
  });

  it("enforces limits across service instances via shared redis backend", async () => {
    inMemory.clear();
    const serviceA = new LoginRateLimiterService(config(1, 300) as never, redis as never);
    const serviceB = new LoginRateLimiterService(config(1, 300) as never, redis as never);

    await serviceA.registerFailure("shared");

    await expect(serviceB.check("shared")).rejects.toThrowError(/Too many login attempts/i);
  });
});
