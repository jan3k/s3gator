import { Body, Controller, Get, Ip, Param, Post, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { BUCKET_PERMISSIONS } from "@s3gator/shared";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import { BucketsService } from "./buckets.service.js";

const setPermissionsSchema = z.object({
  permissions: z.array(z.enum(BUCKET_PERMISSIONS)).default([])
});

@Controller()
export class BucketsController {
  constructor(private readonly bucketsService: BucketsService) {}

  @Get("buckets")
  listForUser(@CurrentUser() user: AuthenticatedRequest["user"]) {
    if (!user) {
      return [];
    }
    return this.bucketsService.listForUser(user);
  }

  @Get("admin/buckets")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN", "ADMIN")
  listAll() {
    return this.bucketsService.listAll();
  }

  @Post("admin/buckets/sync")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN")
  sync(@CurrentUser() actor: AuthenticatedRequest["user"], @Ip() ipAddress: string) {
    if (!actor) {
      return [];
    }
    return this.bucketsService.syncFromGarage(actor, ipAddress);
  }

  @Put("admin/buckets/:bucketId/grants/:userId")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN", "ADMIN")
  setUserBucketPermissions(
    @CurrentUser() actor: AuthenticatedRequest["user"],
    @Param("bucketId") bucketId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!actor) {
      return [];
    }
    const parsed = setPermissionsSchema.parse(body);
    return this.bucketsService.setUserBucketPermissions(actor, userId, bucketId, parsed.permissions, ipAddress);
  }

  @Get("admin/buckets/:bucketId/grants")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN", "ADMIN")
  grants(@Param("bucketId") bucketId: string) {
    return this.bucketsService.getBucketGrants(bucketId);
  }
}
