import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { AuditService } from "./audit.service.js";

@Controller("admin/audit")
@UseGuards(RoleGuard)
@RequireRoles("SUPER_ADMIN")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.auditService.list(limit ? Number(limit) : 200);
  }
}
