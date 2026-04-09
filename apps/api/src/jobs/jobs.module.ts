import { Global, Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { ConnectionsModule } from "@/connections/connections.module.js";
import { JobsController } from "./jobs.controller.js";
import { JobsService } from "./jobs.service.js";
import { JobsWorkerService } from "./jobs.worker.service.js";
import { JobRetentionService } from "./job-retention.service.js";

@Global()
@Module({
  imports: [AuditModule, ConnectionsModule],
  controllers: [JobsController],
  providers: [JobsService, JobsWorkerService, JobRetentionService],
  exports: [JobsService, JobsWorkerService, JobRetentionService]
})
export class JobsModule {}
