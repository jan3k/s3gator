import { Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { ConnectionsService } from "./connections.service.js";
import { ConnectionsController } from "./connections.controller.js";

@Module({
  imports: [AuditModule],
  providers: [ConnectionsService],
  controllers: [ConnectionsController],
  exports: [ConnectionsService]
})
export class ConnectionsModule {}
