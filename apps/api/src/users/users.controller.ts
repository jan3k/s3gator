import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { roleSchema } from "@s3gator/shared";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
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
  list() {
    return this.usersService.list();
  }

  @Post()
  @RequireRoles("SUPER_ADMIN")
  create(@Body() body: unknown) {
    const parsed = createUserSchema.parse(body);
    return this.usersService.createLocal({
      ...parsed,
      role: parsed.role ?? "USER"
    });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.usersService.updateUser(id, updateUserSchema.parse(body));
  }
}
