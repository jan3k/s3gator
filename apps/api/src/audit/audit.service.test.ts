import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "./audit.service.js";

const prisma = {
  auditLog: {
    create: vi.fn(),
    findMany: vi.fn()
  },
  auditLogArchive: {
    findMany: vi.fn(),
    count: vi.fn()
  }
};

describe("AuditService", () => {
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditService(prisma as never);
  });

  it("lists archived audit logs with pagination and deterministic ordering", async () => {
    prisma.auditLogArchive.findMany.mockResolvedValue([
      {
        id: "arch-log-1",
        sourceAuditLogId: "log-1",
        actorUserId: "user-1",
        correlationId: "req-1",
        action: "auth.login.success",
        entityType: "session",
        entityId: "sid-1",
        metadata: { foo: "bar" },
        ipAddress: "127.0.0.1",
        createdAt: new Date("2026-04-09T11:00:00.000Z"),
        archivedAt: new Date("2026-04-10T11:00:00.000Z")
      }
    ]);
    prisma.auditLogArchive.count.mockResolvedValue(1);

    const result = await service.listArchive({
      limit: 50,
      offset: 20,
      action: "auth.login",
      entityType: "session",
      correlationId: "req-1",
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-11T00:00:00.000Z"
    });

    expect(prisma.auditLogArchive.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 20,
        take: 50,
        where: expect.objectContaining({
          correlationId: { equals: "req-1" },
          action: expect.objectContaining({ contains: "auth.login" })
        })
      })
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe("arch-log-1");
    expect(result.items[0]?.createdAt).toBe("2026-04-09T11:00:00.000Z");
  });

  it("applies safe field search filters for archive rows", async () => {
    prisma.auditLogArchive.findMany.mockResolvedValue([]);
    prisma.auditLogArchive.count.mockResolvedValue(0);

    await service.listArchive({
      search: "bucket.sync"
    });

    expect(prisma.auditLogArchive.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ action: expect.any(Object) }),
            expect.objectContaining({ entityType: expect.any(Object) }),
            expect.objectContaining({ entityId: expect.any(Object) })
          ])
        })
      })
    );
  });
});
