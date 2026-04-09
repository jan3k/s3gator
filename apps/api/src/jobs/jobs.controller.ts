import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { JobsService } from "./jobs.service.js";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  scope: z.enum(["mine", "all"]).optional()
});

@Controller("jobs")
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedRequest["user"], @Query() query: unknown) {
    if (!actor) {
      return [];
    }

    const parsed = listSchema.parse(query);
    return this.jobsService.list(actor, parsed);
  }

  @Get(":id")
  details(@CurrentUser() actor: AuthenticatedRequest["user"], @Param("id") id: string) {
    if (!actor) {
      return null;
    }

    return this.jobsService.getById(actor, id);
  }

  @Post(":id/cancel")
  cancel(@CurrentUser() actor: AuthenticatedRequest["user"], @Param("id") id: string) {
    if (!actor) {
      return null;
    }

    return this.jobsService.requestCancel(actor, id);
  }

  @Post("maintenance/upload-cleanup")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN", "ADMIN")
  queueUploadCleanup(@CurrentUser() actor: AuthenticatedRequest["user"]) {
    if (!actor) {
      return null;
    }

    return this.jobsService.enqueueUploadCleanup({
      actor,
      reason: "manual"
    });
  }
}
