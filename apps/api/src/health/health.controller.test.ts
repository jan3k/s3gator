import { ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller.js";

const healthService = {
  liveness: vi.fn(),
  readiness: vi.fn()
};

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new HealthController(healthService as never);
  });

  it("returns live payload", () => {
    healthService.liveness.mockReturnValue({ status: "ok" });

    expect(controller.live()).toEqual({ status: "ok" });
  });

  it("throws 503 when readiness is degraded", async () => {
    healthService.readiness.mockResolvedValue({
      status: "degraded",
      checks: {
        database: true,
        redis: false
      }
    });

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
