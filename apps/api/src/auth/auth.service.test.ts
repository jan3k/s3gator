import { UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";

const prisma = {
  appSetting: {
    findUnique: vi.fn()
  },
  ldapConfig: {
    findUnique: vi.fn()
  },
  user: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  },
  role: {
    findUnique: vi.fn()
  }
};

const ldapAuthService = {
  authenticate: vi.fn()
};

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.appSetting.findUnique.mockResolvedValue({ value: "local" });
    prisma.ldapConfig.findUnique.mockResolvedValue({ enabled: true });
    service = new AuthService(prisma as never, ldapAuthService as never);
  });

  it("blocks LDAP login when auth_mode is local", async () => {
    await expect(
      service.login({ username: "user", password: "password123", mode: "ldap" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("blocks local login when auth_mode is ldap", async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: "ldap" });

    await expect(
      service.login({ username: "user", password: "password123", mode: "local" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("authenticates local login when enabled", async () => {
    const passwordHash = await argon2.hash("password123", { type: argon2.argon2id });
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      username: "user",
      email: "user@example.com",
      displayName: "User",
      isActive: true,
      role: { code: "USER" },
      localCreds: {
        passwordHash
      }
    });

    const result = await service.login({
      username: "user",
      password: "password123",
      mode: "local"
    });

    expect(result.method).toBe("local");
    expect(result.authMode).toBe("local");
    expect(result.user.username).toBe("user");
  });

  it("uses LDAP fallback in hybrid mode when local auth fails", async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: "hybrid" });
    prisma.user.findUnique.mockResolvedValue(null);

    ldapAuthService.authenticate.mockResolvedValue({
      username: "ldap-user",
      email: "ldap@example.com",
      displayName: "LDAP User",
      role: "USER"
    });

    prisma.role.findUnique.mockResolvedValue({ id: "role-user", code: "USER" });
    prisma.user.upsert.mockResolvedValue({
      id: "u-ldap",
      username: "ldap-user",
      email: "ldap@example.com",
      displayName: "LDAP User",
      role: { code: "USER" }
    });

    const result = await service.login({ username: "ldap-user", password: "password123" });

    expect(result.method).toBe("ldap");
    expect(result.authMode).toBe("hybrid");
    expect(ldapAuthService.authenticate).toHaveBeenCalledWith("ldap-user", "password123");
  });
});
