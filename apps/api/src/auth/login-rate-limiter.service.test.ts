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
  it("blocks after max attempts", () => {
    const service = new LoginRateLimiterService(config(2, 300) as never);

    service.check("k");
    service.registerFailure("k");
    service.check("k");
    service.registerFailure("k");

    expect(() => service.check("k")).toThrowError(/Too many login attempts/i);
  });

  it("clears attempt state", () => {
    const service = new LoginRateLimiterService(config(1, 300) as never);

    service.registerFailure("k");
    expect(() => service.check("k")).toThrow();

    service.clear("k");
    expect(() => service.check("k")).not.toThrow();
  });
});
