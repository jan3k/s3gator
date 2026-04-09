import { Module } from "@nestjs/common";
import { AuthorizationService } from "./authorization.service.js";
import { RoleGuard } from "./role.guard.js";
import { BucketPermissionGuard } from "./bucket-permission.guard.js";

@Module({
  providers: [AuthorizationService, RoleGuard, BucketPermissionGuard],
  exports: [AuthorizationService, RoleGuard, BucketPermissionGuard]
})
export class AuthorizationModule {}
