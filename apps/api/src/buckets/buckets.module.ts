import { Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { AuthorizationModule } from "@/authorization/authorization.module.js";
import { ConnectionsModule } from "@/connections/connections.module.js";
import { BucketsService } from "./buckets.service.js";
import { BucketsController } from "./buckets.controller.js";

@Module({
  imports: [AuditModule, AuthorizationModule, ConnectionsModule],
  providers: [BucketsService],
  controllers: [BucketsController],
  exports: [BucketsService]
})
export class BucketsModule {}
