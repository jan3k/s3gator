import { Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { AuthorizationModule } from "@/authorization/authorization.module.js";
import { ConnectionsModule } from "@/connections/connections.module.js";
import { FilesService } from "./files.service.js";
import { FilesController } from "./files.controller.js";

@Module({
  imports: [ConnectionsModule, AuthorizationModule, AuditModule],
  providers: [FilesService],
  controllers: [FilesController],
  exports: [FilesService]
})
export class FilesModule {}
