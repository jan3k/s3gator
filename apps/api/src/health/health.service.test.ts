import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthService } from "./health.service.js";

const prisma = {
  $queryRaw: vi.fn()
};

const redisService = {
  ping: vi.fn()
};

describe("HealthService", () => {
  let service: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HealthService(prisma as never, redisService as never);
  });

  it("reports liveness", async () => {
    const result = await service.liveness();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("s3gator-api");
  });

  it("reports ready when db and redis are healthy", async () => {
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    redisService.ping.mockResolvedValue(true);

    const result = await service.readiness();

    expect(result.status).toBe("ready");
    expect(result.checks).toEqual({
      database: true,
      redis: true
    });
  });

  it("reports degraded when redis health fails", async () => {
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    redisService.ping.mockResolvedValue(false);

    const result = await service.readiness();

    expect(result.status).toBe("degraded");
    expect(result.checks).toEqual({
      database: true,
      redis: false
    });
  });
});
