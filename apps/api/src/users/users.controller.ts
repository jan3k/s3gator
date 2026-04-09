import { Body, Controller, Get, Ip, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { roleSchema } from "@s3gator/shared";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { UsersService } from "./users.service.js";

const createUserSchema = z.object({
  username: z.string().min(1),
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  password: z.string().min(8),
  role: roleSchema.default("USER")
});

const updateUserSchema = z
  .object({
    email: z.string().email().nullable().optional(),
    displayName: z.string().min(1).nullable().optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).optional()
  })
  .refine((obj) => Object.keys(obj).length > 0, "At least one field is required");

@Controller("admin/users")
@UseGuards(RoleGuard)
@RequireRoles("SUPER_ADMIN", "ADMIN")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedRequest["user"]) {
    if (!actor) {
      return [];
    }
    return this.usersService.list(actor);
  }

  @Post()
  @RequireRoles("SUPER_ADMIN")
  create(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }

    const parsed = createUserSchema.parse(body);
    return this.usersService.createLocal({
      ...parsed,
      role: parsed.role ?? "USER"
    }, actor, ipAddress);
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
    return this.usersService.updateUser(actor, id, updateUserSchema.parse(body), ipAddress);
  }
}
