import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "@/common/public.decorator.js";
import { MetricsService } from "./metrics.service.js";

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4")
  async metrics() {
    return this.metricsService.renderMetrics();
  }
}
