import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsController } from "./metrics.controller.js";

const metricsService = {
  renderMetrics: vi.fn()
};

describe("MetricsController", () => {
  let controller: MetricsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MetricsController(metricsService as never);
  });

  it("returns rendered prometheus metrics payload", async () => {
    metricsService.renderMetrics.mockResolvedValue("# HELP s3gator_login_total Login");

    const output = await controller.metrics();

    expect(output).toContain("s3gator_login_total");
  });
});
