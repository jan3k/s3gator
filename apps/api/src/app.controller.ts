import { Controller, Get } from "@nestjs/common";
import { Public } from "@/common/public.decorator.js";

@Controller()
export class AppController {
  @Public()
  @Get("health")
  health() {
    return {
      status: "ok",
      service: "s3gator-api"
    };
  }
}
