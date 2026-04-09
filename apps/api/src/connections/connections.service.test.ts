import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsService } from "./connections.service.js";

function makeConnectionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-04-09T00:00:00.000Z");
  return {
    id: "conn-1",
    name: "default",
    endpoint: "https://garage.example.local",
    region: "garage",
    forcePathStyle: true,
    accessKeyEncrypted: "enc-access",
    secretKeyEncrypted: "enc-secret",
    adminApiUrl: "https://garage-admin.example.local",
    adminTokenEncrypted: "enc-token",
    isDefault: true,
    healthStatus: "healthy",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

const prisma = {
  garageConnection: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn()
  }
};

const cryptoService = {
  encrypt: vi.fn((value: string) => `enc(${value})`),
  decrypt: vi.fn((value: string) => `dec(${value})`)
};

const configService = {
  get: vi.fn()
};

const auditService = {
  record: vi.fn()
};

describe("ConnectionsService response redaction", () => {
  let service: ConnectionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConnectionsService(
      prisma as never,
      cryptoService as never,
      configService as never,
      auditService as never
    );
  });

  it("does not expose encrypted fields on list", async () => {
    prisma.garageConnection.findMany.mockResolvedValue([makeConnectionRow()]);

    const result = await service.listPublic();

    expect(result).toHaveLength(1);
    expect((result[0] as Record<string, unknown>).accessKeyEncrypted).toBeUndefined();
    expect((result[0] as Record<string, unknown>).secretKeyEncrypted).toBeUndefined();
    expect((result[0] as Record<string, unknown>).adminTokenEncrypted).toBeUndefined();
  });

  it("does not expose encrypted fields on create", async () => {
    prisma.garageConnection.updateMany.mockResolvedValue({ count: 0 });
    prisma.garageConnection.create.mockResolvedValue(makeConnectionRow());

    const result = await service.create(
      {
        id: "actor-1",
        username: "super",
        email: "super@example.com",
        displayName: "Super",
        role: "SUPER_ADMIN"
      },
      {
        name: "default",
        endpoint: "https://garage.example.local",
        region: "garage",
        accessKeyId: "access",
        secretAccessKey: "secret",
        adminApiUrl: "https://garage-admin.example.local",
        adminToken: "token",
        isDefault: true
      }
    );

    expect(result.name).toBe("default");
    expect((result as Record<string, unknown>).accessKeyEncrypted).toBeUndefined();
    expect((result as Record<string, unknown>).secretKeyEncrypted).toBeUndefined();
    expect((result as Record<string, unknown>).adminTokenEncrypted).toBeUndefined();
  });
});
