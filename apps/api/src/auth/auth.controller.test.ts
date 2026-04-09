import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller.js";

const authService = {
  login: vi.fn(),
  getAuthModeInfo: vi.fn()
};

const sessionService = {
  createSession: vi.fn(),
  revokeSession: vi.fn()
};

const limiter = {
  check: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  registerFailure: vi.fn().mockResolvedValue(undefined)
};

const configService = {
  get: vi.fn((key: string, fallback?: unknown) => {
    if (key === "SESSION_COOKIE_NAME") {
      return "s3gator_sid";
    }
    if (key === "NODE_ENV") {
      return "test";
    }
    if (key === "SESSION_TTL_HOURS") {
      return 24;
    }
    return fallback;
  })
};

const auditService = {
  record: vi.fn()
};

const metricsService = {
  recordLogin: vi.fn()
};

describe("AuthController audit", () => {
  let controller: AuthController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AuthController(
      authService as never,
      sessionService as never,
      limiter as never,
      configService as never,
      auditService as never,
      metricsService as never
    );
  });

  it("writes audit log for successful local login", async () => {
    authService.login.mockResolvedValue({
      user: {
        id: "user-1",
        username: "admin",
        email: "admin@example.com",
        displayName: "Admin",
        role: "SUPER_ADMIN"
      },
      method: "local",
      authMode: "local"
    });

    sessionService.createSession.mockResolvedValue({
      token: "session-token",
      csrfToken: "csrf-token"
    });

    const response = {
      cookie: vi.fn()
    };

    await controller.login(
      {
        username: "admin",
        password: "password123",
        mode: "local"
      },
      "127.0.0.1",
      { headers: { "user-agent": "vitest" } } as never,
      response as never
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.login.success.local", ipAddress: "127.0.0.1" })
    );
    expect(metricsService.recordLogin).toHaveBeenCalledWith("success", "local", expect.any(Number));
  });

  it("writes audit log for failed login", async () => {
    authService.login.mockRejectedValue(new UnauthorizedException("Invalid username or password"));

    await expect(
      controller.login(
        {
          username: "admin",
          password: "password123",
          mode: "local"
        },
        "127.0.0.1",
        { headers: { "user-agent": "vitest" } } as never,
        { cookie: vi.fn() } as never
      )
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(limiter.registerFailure).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.login.failure", ipAddress: "127.0.0.1" })
    );
    expect(metricsService.recordLogin).toHaveBeenCalledWith("failure", "local", expect.any(Number));
  });
});
