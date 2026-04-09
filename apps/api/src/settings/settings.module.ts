import { Module } from "@nestjs/common";
import { SettingsService } from "./settings.service.js";
import { SettingsController } from "./settings.controller.js";

@Module({
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService]
})
export class SettingsModule {}
