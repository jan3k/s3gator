import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "@/common/public.decorator.js";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get("live")
  live() {
    return this.healthService.liveness();
  }

  @Public()
  @Get("ready")
  async ready() {
    try {
      const readiness = await this.healthService.readiness();
      if (readiness.status !== "ready") {
        throw new ServiceUnavailableException(readiness);
      }
      return readiness;
    } catch (error) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}
