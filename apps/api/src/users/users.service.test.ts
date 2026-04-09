import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersService } from "./users.service.js";

const prisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn()
  },
  role: {
    findUnique: vi.fn()
  },
  localCredential: {
    update: vi.fn(),
    create: vi.fn()
  }
};

const auditService = {
  record: vi.fn()
};

describe("UsersService hardening", () => {
  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UsersService(prisma as never, auditService as never);
  });

  it("prevents ADMIN from escalating a USER to SUPER_ADMIN", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "target-user",
      username: "user1",
      isActive: true,
      role: { code: "USER" },
      localCreds: {
        passwordHash: "hash"
      }
    });

    await expect(
      service.updateUser(
        {
          id: "actor-admin",
          username: "admin1",
          email: "admin@example.com",
          displayName: "Admin",
          role: "ADMIN"
        },
        "target-user",
        { role: "SUPER_ADMIN" }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("prevents ADMIN from modifying SUPER_ADMIN accounts", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "target-super",
      username: "super1",
      isActive: true,
      role: { code: "SUPER_ADMIN" },
      localCreds: {
        passwordHash: "hash"
      }
    });

    await expect(
      service.updateUser(
        {
          id: "actor-admin",
          username: "admin1",
          email: "admin@example.com",
          displayName: "Admin",
          role: "ADMIN"
        },
        "target-super",
        { displayName: "Nope" }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows SUPER_ADMIN to promote USER to SUPER_ADMIN", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "target-user",
      username: "user1",
      isActive: true,
      role: { code: "USER" },
      localCreds: {
        passwordHash: "hash"
      }
    });

    prisma.role.findUnique.mockResolvedValueOnce({ id: "role-super", code: "SUPER_ADMIN" });
    prisma.user.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "target-user",
      username: "user1",
      isActive: true,
      role: { code: "SUPER_ADMIN" }
    });

    const updated = await service.updateUser(
      {
        id: "actor-super",
        username: "super",
        email: "super@example.com",
        displayName: "Super",
        role: "SUPER_ADMIN"
      },
      "target-user",
      { role: "SUPER_ADMIN" }
    );

    expect(prisma.user.update).toHaveBeenCalled();
    expect(updated?.role.code).toBe("SUPER_ADMIN");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.role.change", entityId: "target-user" })
    );
  });
});
