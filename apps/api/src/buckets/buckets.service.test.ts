import { beforeEach, describe, expect, it, vi } from "vitest";
import { BucketsService } from "./buckets.service.js";

const prisma = {
  adminBucketScope: {
    findFirst: vi.fn()
  },
  bucket: {
    findUnique: vi.fn()
  },
  user: {
    findUnique: vi.fn()
  },
  permission: {
    findMany: vi.fn()
  },
  userBucketPermission: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn()
  }
};

const authorizationService = {
  listAccessibleBuckets: vi.fn()
};

const connectionsService = {
  getDefaultConnectionWithSecrets: vi.fn()
};

const auditService = {
  record: vi.fn()
};

describe("BucketsService audit", () => {
  let service: BucketsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BucketsService(
      prisma as never,
      authorizationService as never,
      connectionsService as never,
      auditService as never
    );
  });

  it("writes audit log when bucket grants are updated", async () => {
    prisma.adminBucketScope.findFirst.mockResolvedValue({ id: "scope-1" });
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "alice",
      role: { code: "USER" }
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: "perm-1", code: "bucket:list" },
      { id: "perm-2", code: "object:list" }
    ]);
    prisma.userBucketPermission.deleteMany.mockResolvedValue({ count: 2 });
    prisma.userBucketPermission.createMany.mockResolvedValue({ count: 2 });
    prisma.userBucketPermission.findMany.mockResolvedValue([]);

    await service.setUserBucketPermissions(
      {
        id: "actor-super",
        username: "super",
        email: "super@example.com",
        displayName: "Super",
        role: "SUPER_ADMIN"
      },
      "user-1",
      "bucket-1",
      ["bucket:list", "object:list"]
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bucket.grants.update",
        entityId: "bucket-1"
      })
    );
  });

  it("blocks ADMIN from changing grants outside assigned scope", async () => {
    prisma.adminBucketScope.findFirst.mockResolvedValue(null);

    await expect(
      service.setUserBucketPermissions(
        {
          id: "admin-1",
          username: "admin",
          email: "admin@example.com",
          displayName: "Admin",
          role: "ADMIN"
        },
        "user-1",
        "bucket-1",
        ["bucket:list"]
      )
    ).rejects.toThrowError(/not scoped/i);
  });
});
