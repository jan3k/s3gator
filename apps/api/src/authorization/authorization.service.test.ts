import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "./authorization.service.js";

const prisma = {
  bucket: {
    findUnique: vi.fn(),
    findMany: vi.fn()
  },
  userBucketPermission: {
    findFirst: vi.fn()
  }
};

describe("AuthorizationService bucket semantics", () => {
  let service: AuthorizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthorizationService(prisma as never);
  });

  it("requires explicit permission code in requireBucketPermission", async () => {
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-id" });
    prisma.userBucketPermission.findFirst.mockResolvedValue(null);

    await expect(
      service.requireBucketPermission(
        {
          id: "user-1",
          username: "user1",
          email: null,
          displayName: null,
          role: "USER"
        },
        "bucket-a",
        "bucket:list"
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.userBucketPermission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          permission: {
            code: "bucket:list"
          }
        })
      })
    );
  });

  it("lists non-super buckets only by explicit bucket:list grant", async () => {
    prisma.bucket.findMany.mockResolvedValue([]);

    await service.listAccessibleBuckets({
      id: "user-1",
      username: "user1",
      email: null,
      displayName: null,
      role: "USER"
    });

    expect(prisma.bucket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userPermissions: {
            some: {
              permission: {
                code: "bucket:list"
              },
              userId: "user-1"
            }
          }
        })
      })
    );
  });
});
