import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
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
  create(@Body() body: unknown) {
    return this.connectionsService.create(createSchema.parse(body));
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.connectionsService.update(id, updateSchema.parse(body));
  }

  @Post(":id/health")
  health(@Param("id") id: string) {
    return this.connectionsService.healthCheck(id);
  }
}
