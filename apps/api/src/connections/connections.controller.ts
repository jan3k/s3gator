import { Body, Controller, Get, Ip, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { ConnectionsService } from "./connections.service.js";

const createSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().min(1),
  forcePathStyle: z.boolean().optional(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  adminApiUrl: z.string().url().optional().nullable(),
  adminToken: z.string().optional().nullable(),
  isDefault: z.boolean().optional()
});

const updateSchema = createSchema.partial();

@Controller("admin/connections")
@UseGuards(RoleGuard)
@RequireRoles("SUPER_ADMIN")
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  list() {
    return this.connectionsService.listPublic();
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }
    return this.connectionsService.create(actor, createSchema.parse(body), ipAddress);
  }

  @Patch(":id")
  update(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }
    return this.connectionsService.update(actor, id, updateSchema.parse(body), ipAddress);
  }

  @Post(":id/health")
  health(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Param("id") id: string,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }
    return this.connectionsService.healthCheck(actor, id, ipAddress);
  }
}
