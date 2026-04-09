import { Module } from "@nestjs/common";
import { AuditModule } from "@/audit/audit.module.js";
import { UsersService } from "./users.service.js";
import { UsersController } from "./users.controller.js";

@Module({
  imports: [AuditModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService]
})
export class UsersModule {}
