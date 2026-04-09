import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { AuditService } from "./audit.service.js";

const listAuditSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  search: z.string().min(1).max(200).optional(),
  action: z.string().min(1).max(200).optional(),
  entityType: z.string().min(1).max(200).optional()
});

@Controller("admin/audit")
@UseGuards(RoleGuard)
@RequireRoles("SUPER_ADMIN")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.auditService.list(listAuditSchema.parse(query));
  }
}
