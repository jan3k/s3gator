import { Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { JobsService } from "./jobs.service.js";
import { JobRetentionService } from "./job-retention.service.js";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  scope: z.enum(["mine", "all"]).optional()
});

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

@Controller("jobs")
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly retentionService: JobRetentionService
  ) {}

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

  @Get(":id/detail")
  detailWithTimeline(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Param("id") id: string,
    @Query() query: unknown
  ) {
    if (!actor) {
      return null;
    }

    const parsed = eventsQuerySchema.parse(query);
    return this.jobsService.getDetail(actor, id, parsed.limit ?? 200);
  }

  @Get(":id/events")
  events(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Param("id") id: string,
    @Query() query: unknown
  ) {
    if (!actor) {
      return [];
    }

    const parsed = eventsQuerySchema.parse(query);
    return this.jobsService.listEvents(actor, id, parsed.limit ?? 200);
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
  queueUploadCleanup(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Req() req: AuthenticatedRequest
  ) {
    if (!actor) {
      return null;
    }

    return this.jobsService.enqueueUploadCleanup({
      actor,
      reason: "manual",
      correlationId: req.correlationId
    });
  }

  @Get("maintenance/retention-policy")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN", "ADMIN")
  retentionPolicy() {
    return this.retentionService.getPolicy();
  }

  @Post("maintenance/retention-cleanup")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN")
  queueRetentionCleanup(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Req() req: AuthenticatedRequest
  ) {
    if (!actor) {
      return null;
    }

    return this.jobsService.enqueueRetentionCleanup({
      actor,
      reason: "manual",
      correlationId: req.correlationId
    });
  }
}
