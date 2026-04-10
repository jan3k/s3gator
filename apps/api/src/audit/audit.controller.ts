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

const listAuditArchiveSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  search: z.string().min(1).max(200).optional(),
  action: z.string().min(1).max(200).optional(),
  entityType: z.string().min(1).max(200).optional(),
  correlationId: z.string().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
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

  @Get("archive")
  listArchive(@Query() query: unknown) {
    return this.auditService.listArchive(listAuditArchiveSchema.parse(query));
  }
}
