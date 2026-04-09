import { Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { SettingsService } from "./settings.service.js";
import { SettingsController } from "./settings.controller.js";

@Module({
  imports: [AuditModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService]
})
export class SettingsModule {}
