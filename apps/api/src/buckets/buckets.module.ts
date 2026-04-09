import { Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { BucketsService } from "./buckets.service.js";
import { BucketsController } from "./buckets.controller.js";

@Module({
  imports: [AuditModule],
  providers: [BucketsService],
  controllers: [BucketsController],
  exports: [BucketsService]
})
export class BucketsModule {}
