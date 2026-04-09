import { Body, Controller, Delete, Get, Ip, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  createFolderSchema,
  deleteSchema,
  listSchema,
  previewSchema,
  renameSchema,
  searchSchema
} from "@s3gator/shared";
import { CurrentUser } from "@/auth/current-user.decorator.js";
import { BucketPermissionGuard } from "@/authorization/bucket-permission.guard.js";
import { RequireBucketPermission } from "@/authorization/permission.decorator.js";
import { RoleGuard } from "@/authorization/role.guard.js";
import { RequireRoles } from "@/authorization/role.decorator.js";
import type { AuthenticatedRequest } from "@/common/request-context.js";
import { FilesService } from "./files.service.js";
import { JobsService } from "@/jobs/jobs.service.js";

const statsSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().default("")
});

const initMultipartSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  contentType: z.string().optional(),
  fileSize: z.coerce.number().int().min(0).optional(),
  partSize: z.coerce.number().int().min(5 * 1024 * 1024).max(128 * 1024 * 1024).optional(),
  totalParts: z.coerce.number().int().min(1).max(10_000).optional(),
  relativePath: z.string().optional()
});

const signPartsSchema = z.object({
  partNumbers: z.array(z.coerce.number().int().min(1).max(10_000)).min(1).max(10_000)
});

const completeSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.coerce.number().int().min(1),
        eTag: z.string().min(1)
      })
    )
    .min(1)
});

const failSchema = z.object({
  error: z.string().min(1).max(2000).optional()
});

const partCompleteSchema = z.object({
  partNumber: z.coerce.number().int().min(1).max(10_000),
  eTag: z.string().min(1)
});

const recoverSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  fileSize: z.coerce.number().int().min(0),
  partSize: z.coerce.number().int().min(5 * 1024 * 1024).max(128 * 1024 * 1024)
});

const multipartSessionsSchema = z.object({
  scope: z.enum(["mine", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return undefined;
      }
      const input = Array.isArray(value) ? value : value.split(",");
      return input.filter(Boolean) as Array<"INITIATED" | "IN_PROGRESS" | "FAILED" | "COMPLETED" | "ABORTED">;
    })
});

@Controller("files")
@UseGuards(BucketPermissionGuard)
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly jobsService: JobsService
  ) {}

  @Get("list")
  @RequireBucketPermission("object:list", "bucket", "query")
  list(@CurrentUser() user: AuthenticatedRequest["user"], @Query() query: unknown) {
    const parsed = listSchema.parse(query);
    if (!user) {
      return [];
    }

    return this.filesService.list(user, parsed);
  }

  @Post("folder")
  @RequireBucketPermission("folder:create", "bucket", "body")
  createFolder(@CurrentUser() user: AuthenticatedRequest["user"], @Body() body: unknown, @Ip() ipAddress: string) {
    if (!user) {
      return { error: "not authenticated" };
    }
    const parsed = createFolderSchema.parse(body);
    return this.filesService.createFolder(user, parsed, ipAddress);
  }

  @Delete()
  async delete(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Body() body: unknown,
    @Ip() ipAddress: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }
    const parsed = deleteSchema.parse(body);

    if (parsed.key.endsWith("/")) {
      await this.filesService.ensureDeletePermission(user, parsed);
      const job = await this.jobsService.enqueueFolderDelete({
        actor: user,
        bucket: parsed.bucket,
        key: parsed.key,
        ipAddress,
        correlationId: req.correlationId
      });

      return {
        mode: "job",
        job
      };
    }

    return this.filesService.remove(user, parsed, ipAddress);
  }

  @Post("rename")
  async rename(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Body() body: unknown,
    @Ip() ipAddress: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }
    const parsed = renameSchema.parse(body);

    if (parsed.oldKey.endsWith("/") || parsed.newKey.endsWith("/")) {
      await this.filesService.ensureRenamePermission(user, parsed);
      const job = await this.jobsService.enqueueFolderRename({
        actor: user,
        bucket: parsed.bucket,
        oldKey: parsed.oldKey,
        newKey: parsed.newKey,
        ipAddress,
        correlationId: req.correlationId
      });

      return {
        mode: "job",
        job
      };
    }

    return this.filesService.rename(user, parsed, ipAddress);
  }

  @Get("preview")
  @RequireBucketPermission("object:preview", "bucket", "query")
  preview(@CurrentUser() user: AuthenticatedRequest["user"], @Query() query: unknown) {
    if (!user) {
      return { error: "not authenticated" };
    }
    const parsed = previewSchema.parse(query);
    return this.filesService.preview(user, parsed);
  }

  @Get("search")
  @RequireBucketPermission("search:run", "bucket", "query")
  search(@CurrentUser() user: AuthenticatedRequest["user"], @Query() query: unknown) {
    if (!user) {
      return { error: "not authenticated" };
    }
    const parsed = searchSchema.parse(query);
    return this.filesService.search(user, parsed);
  }

  @Get("stats")
  @RequireBucketPermission("folder:stats", "bucket", "query")
  stats(@CurrentUser() user: AuthenticatedRequest["user"], @Query() query: unknown) {
    if (!user) {
      return { error: "not authenticated" };
    }
    const parsed = statsSchema.parse(query);
    return this.filesService.stats(user, parsed);
  }

  @Post("multipart/init")
  @RequireBucketPermission("object:upload", "bucket", "body")
  initMultipart(@CurrentUser() user: AuthenticatedRequest["user"], @Body() body: unknown) {
    if (!user) {
      return { error: "not authenticated" };
    }

    const parsed = initMultipartSchema.parse(body);
    return this.filesService.initMultipartSession(user, parsed);
  }

  @Post("multipart/recover")
  @RequireBucketPermission("object:upload", "bucket", "body")
  recoverMultipart(@CurrentUser() user: AuthenticatedRequest["user"], @Body() body: unknown) {
    if (!user) {
      return { error: "not authenticated" };
    }

    const parsed = recoverSchema.parse(body);
    return this.filesService.findRecoverableSession(user, parsed);
  }

  @Post("multipart/:uploadSessionId/sign-parts")
  signParts(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("uploadSessionId") uploadSessionId: string,
    @Body() body: unknown
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }

    const parsed = signPartsSchema.parse(body);
    return this.filesService.signMultipartParts(user, uploadSessionId, parsed.partNumbers);
  }

  @Post("multipart/:uploadSessionId/part-complete")
  partComplete(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("uploadSessionId") uploadSessionId: string,
    @Body() body: unknown
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }

    const parsed = partCompleteSchema.parse(body);
    return this.filesService.recordMultipartPart(user, uploadSessionId, parsed);
  }

  @Post("multipart/:uploadSessionId/complete")
  complete(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("uploadSessionId") uploadSessionId: string,
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }

    const parsed = completeSchema.parse(body);
    return this.filesService.completeMultipart(user, uploadSessionId, parsed.parts, ipAddress);
  }

  @Post("multipart/:uploadSessionId/abort")
  abort(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("uploadSessionId") uploadSessionId: string,
    @Ip() ipAddress: string
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }

    return this.filesService.abortMultipart(user, uploadSessionId, ipAddress);
  }

  @Post("multipart/:uploadSessionId/fail")
  fail(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("uploadSessionId") uploadSessionId: string,
    @Body() body: unknown,
    @Ip() ipAddress: string
  ) {
    if (!user) {
      return { error: "not authenticated" };
    }

    const parsed = failSchema.parse(body);
    return this.filesService.failMultipart(user, uploadSessionId, parsed.error, ipAddress);
  }

  @Get("multipart/sessions")
  multipartSessions(@CurrentUser() user: AuthenticatedRequest["user"], @Query() query: unknown) {
    if (!user) {
      return [];
    }

    const parsed = multipartSessionsSchema.parse(query);
    return this.filesService.listMultipartSessions(user, parsed);
  }

  @Get("multipart/sessions/:uploadSessionId")
  multipartSession(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Param("uploadSessionId") uploadSessionId: string
  ) {
    if (!user) {
      return null;
    }

    return this.filesService.getMultipartSession(user, uploadSessionId);
  }

  @Post("multipart/cleanup-expired")
  @UseGuards(RoleGuard)
  @RequireRoles("SUPER_ADMIN", "ADMIN")
  cleanupMultipart(
    @CurrentUser() user: AuthenticatedRequest["user"],
    @Query("limit") limit?: string
  ) {
    if (!user) {
      return null;
    }

    return this.filesService.cleanupExpiredMultipartSessions(user, limit ? Number(limit) : 100);
  }
}
