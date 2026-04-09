import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  MultiPartUpload,
  abortMultipartUpload,
  addFolder,
  completeMultipartUpload,
  createGarageS3Client,
  deleteFileOrFolder,
  getFilePreview,
  getFolderStats,
  initMultipartUpload,
  listFiles,
  presignMultipartPart,
  renameFileOrFolder,
  searchFilesAndFolders,
  type MultipartCompletePart
} from "@s3gator/s3";
import type { BucketPermission, SessionUser } from "@s3gator/shared";
import type { Prisma } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/prisma/prisma.service.js";
import { ConnectionsService } from "@/connections/connections.service.js";
import { AuthorizationService } from "@/authorization/authorization.service.js";
import { AuditService } from "@/audit/audit.service.js";
import { MetricsService } from "@/metrics/metrics.service.js";

@Injectable()
export class FilesService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly connectionsService: ConnectionsService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {}

  async ensureDeletePermission(user: SessionUser, input: { bucket: string; key: string }) {
    const permission: BucketPermission = input.key.endsWith("/") ? "folder:delete" : "object:delete";
    await this.authorizationService.requireBucketPermission(user, input.bucket, permission);
  }

  async ensureRenamePermission(user: SessionUser, input: { bucket: string; oldKey: string; newKey: string }) {
    const permission: BucketPermission = input.oldKey.endsWith("/") ? "folder:rename" : "object:rename";
    await this.authorizationService.requireBucketPermission(user, input.bucket, permission);
  }

  async list(user: SessionUser, input: { bucket: string; prefix: string; continuationToken?: string; recursive: boolean; pageSize: number; sortBy: "name" | "size" | "lastModified" | "type"; sortOrder: "asc" | "desc"; }) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "object:list");
    const s3 = await this.getS3Client();

    return listFiles(s3, input.prefix, input.bucket, {
      continuationToken: input.continuationToken,
      recursive: input.recursive,
      pageSize: input.pageSize,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder
    });
  }

  async createFolder(user: SessionUser, input: { bucket: string; folderPath: string }, ipAddress?: string) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "folder:create");
    const s3 = await this.getS3Client();
    const result = await addFolder(s3, input.folderPath, input.bucket);

    await this.auditService.record({
      actor: user,
      action: "folder.create",
      entityType: "object",
      entityId: `${input.bucket}/${result.key}`,
      metadata: { bucket: input.bucket, key: result.key },
      ipAddress
    });

    return result;
  }

  async remove(user: SessionUser, input: { bucket: string; key: string }, ipAddress?: string) {
    await this.ensureDeletePermission(user, input);

    const s3 = await this.getS3Client();
    const startedAt = Date.now();
    const result = await deleteFileOrFolder(s3, input.key, input.bucket).catch((error: Error) => {
      this.metricsService.recordS3Failure(input.key.endsWith("/") ? "folder_delete" : "object_delete");
      throw error;
    });
    this.metricsService.recordS3Duration(
      input.key.endsWith("/") ? "folder_delete" : "object_delete",
      (Date.now() - startedAt) / 1000
    );

    await this.auditService.record({
      actor: user,
      action: "object.delete",
      entityType: "object",
      entityId: `${input.bucket}/${input.key}`,
      metadata: result,
      ipAddress
    });

    return result;
  }

  async rename(user: SessionUser, input: { bucket: string; oldKey: string; newKey: string }, ipAddress?: string) {
    await this.ensureRenamePermission(user, input);

    const s3 = await this.getS3Client();
    const startedAt = Date.now();
    const result = await renameFileOrFolder(s3, input.oldKey, input.newKey, input.bucket).catch((error: Error) => {
      this.metricsService.recordS3Failure(input.oldKey.endsWith("/") ? "folder_rename" : "object_rename");
      throw error;
    });
    this.metricsService.recordS3Duration(
      input.oldKey.endsWith("/") ? "folder_rename" : "object_rename",
      (Date.now() - startedAt) / 1000
    );

    await this.auditService.record({
      actor: user,
      action: "object.rename",
      entityType: "object",
      entityId: `${input.bucket}/${input.oldKey}`,
      metadata: result,
      ipAddress
    });

    return result;
  }

  async preview(user: SessionUser, input: { bucket: string; key: string; download: boolean }) {
    const permission: BucketPermission = input.download ? "object:download" : "object:preview";
    await this.authorizationService.requireBucketPermission(user, input.bucket, permission);

    const s3 = await this.getS3Client();
    return getFilePreview(s3, input.key, input.download, input.bucket);
  }

  async stats(user: SessionUser, input: { bucket: string; prefix: string }) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "folder:stats");
    const s3 = await this.getS3Client();
    return getFolderStats(s3, input.prefix, input.bucket);
  }

  async search(user: SessionUser, input: { bucket: string; prefix: string; term: string; continuationToken?: string; pageSize: number }) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "search:run");
    const s3 = await this.getS3Client();

    return searchFilesAndFolders(
      s3,
      input.prefix,
      input.term,
      input.bucket,
      input.continuationToken,
      input.pageSize
    );
  }

  async initMultipartSession(
    user: SessionUser,
    input: { bucket: string; key: string; contentType?: string; fileSize?: number; partSize?: number; totalParts?: number; relativePath?: string }
  ) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "object:upload");

    const bucket = await this.prisma.bucket.findUnique({ where: { name: input.bucket } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found in app database. Sync buckets first.");
    }

    const s3 = await this.getS3Client();
    const initialized = await initMultipartUpload(s3, {
      bucket: input.bucket,
      key: input.key,
      contentType: input.contentType
    });

    const partSize = input.partSize ?? this.configService.get<number>("UPLOAD_PART_SIZE_BYTES", 10 * 1024 * 1024);
    const totalParts =
      input.totalParts ??
      (input.fileSize !== undefined
        ? Math.max(1, Math.ceil(input.fileSize / Math.max(partSize, 1)))
        : null);
    const ttlHours = this.configService.get<number>("UPLOAD_SESSION_TTL_HOURS", 24);

    const session = await this.prisma.uploadSession.create({
      data: {
        userId: user.id,
        bucketId: bucket.id,
        objectKey: initialized.key,
        uploadId: initialized.uploadId,
        status: "INITIATED",
        partSize,
        totalParts,
        fileSize: input.fileSize === undefined ? null : BigInt(input.fileSize),
        contentType: input.contentType,
        relativePath: input.relativePath,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000)
      }
    });

    this.metricsService.recordUploadEvent("start");

    return {
      uploadSessionId: session.id,
      uploadId: initialized.uploadId,
      key: initialized.key,
      bucket: initialized.bucket
    };
  }

  async signMultipartParts(
    user: SessionUser,
    uploadSessionId: string,
    partNumbers: number[]
  ) {
    const session = await this.getUploadSessionForUser(user, uploadSessionId);
    const bucket = await this.prisma.bucket.findUnique({ where: { id: session.bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }

    await this.authorizationService.requireBucketPermission(user, bucket.name, "object:upload");

    const s3 = await this.getS3Client();
    const parts = await Promise.all(
      partNumbers.map((partNumber) => presignMultipartPart(s3, bucket.name, session.objectKey, session.uploadId, partNumber))
    );

    await this.prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        status: "IN_PROGRESS",
        partsMeta: partNumbers as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
        error: null
      }
    });

    return {
      uploadSessionId,
      parts
    };
  }

  async completeMultipart(
    user: SessionUser,
    uploadSessionId: string,
    parts: MultipartCompletePart[],
    ipAddress?: string
  ) {
    const session = await this.getUploadSessionForUser(user, uploadSessionId);
    const bucket = await this.prisma.bucket.findUnique({ where: { id: session.bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }

    await this.authorizationService.requireBucketPermission(user, bucket.name, "object:upload");

    const s3 = await this.getS3Client();
    const result = await completeMultipartUpload(s3, {
      bucket: bucket.name,
      key: session.objectKey,
      uploadId: session.uploadId,
      parts
    });

    await this.prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        status: "COMPLETED",
        completedParts: parts as unknown as Prisma.InputJsonValue,
        partsMeta: parts as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
        error: null
      }
    });

    await this.auditService.record({
      actor: user,
      action: "object.upload.complete",
      entityType: "object",
      entityId: `${bucket.name}/${session.objectKey}`,
      metadata: result,
      ipAddress
    });

    this.metricsService.recordUploadEvent("complete");

    return result;
  }

  async abortMultipart(user: SessionUser, uploadSessionId: string, ipAddress?: string) {
    const session = await this.getUploadSessionForUser(user, uploadSessionId);
    const bucket = await this.prisma.bucket.findUnique({ where: { id: session.bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }

    await this.authorizationService.requireBucketPermission(user, bucket.name, "object:upload");

    const s3 = await this.getS3Client();
    let abortError: string | null = null;
    try {
      await abortMultipartUpload(s3, bucket.name, session.objectKey, session.uploadId);
    } catch (error) {
      abortError = (error as Error).message;
    }

    await this.prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        status: "ABORTED",
        lastActivityAt: new Date(),
        error: abortError
      }
    });

    await this.auditService.record({
      actor: user,
      action: "object.upload.abort",
      entityType: "object",
      entityId: `${bucket.name}/${session.objectKey}`,
      metadata: {
        abortError
      },
      ipAddress
    });

    this.metricsService.recordUploadEvent("abort");

    return { ok: true, abortError };
  }

  async failMultipart(user: SessionUser, uploadSessionId: string, errorMessage?: string, ipAddress?: string) {
    const session = await this.getUploadSessionForUser(user, uploadSessionId);
    const bucket = await this.prisma.bucket.findUnique({ where: { id: session.bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }

    await this.authorizationService.requireBucketPermission(user, bucket.name, "object:upload");

    const s3 = await this.getS3Client();
    let abortError: string | null = null;
    try {
      await abortMultipartUpload(s3, bucket.name, session.objectKey, session.uploadId);
    } catch (error) {
      abortError = (error as Error).message;
    }

    await this.prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        status: "FAILED",
        lastActivityAt: new Date(),
        error: errorMessage ?? abortError ?? "Multipart upload failed"
      }
    });

    await this.auditService.record({
      actor: user,
      action: "object.upload.failed",
      entityType: "object",
      entityId: `${bucket.name}/${session.objectKey}`,
      metadata: {
        error: errorMessage ?? null,
        abortError
      },
      ipAddress
    });

    this.metricsService.recordUploadEvent("fail");

    return {
      ok: false,
      error: errorMessage ?? "Multipart upload failed",
      abortError
    };
  }

  async uploadFromServer(
    user: SessionUser,
    input: { bucket: string; key: string; body: Buffer | Uint8Array | string; contentType?: string }
  ) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "object:upload");
    const s3 = await this.getS3Client();

    await MultiPartUpload({
      s3,
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      contentType: input.contentType
    });

    return { ok: true };
  }

  async recordMultipartPart(
    user: SessionUser,
    uploadSessionId: string,
    input: { partNumber: number; eTag: string }
  ) {
    const session = await this.getUploadSessionForUser(user, uploadSessionId);
    const bucket = await this.prisma.bucket.findUnique({ where: { id: session.bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }
    await this.authorizationService.requireBucketPermission(user, bucket.name, "object:upload");

    const existing = Array.isArray(session.completedParts)
      ? (session.completedParts as unknown as MultipartCompletePart[])
      : [];

    const dedup = new Map<number, MultipartCompletePart>();
    for (const part of existing) {
      dedup.set(part.partNumber, part);
    }
    dedup.set(input.partNumber, { partNumber: input.partNumber, eTag: input.eTag });

    const completedParts = [...dedup.values()].sort((a, b) => a.partNumber - b.partNumber);
    await this.prisma.uploadSession.update({
      where: { id: uploadSessionId },
      data: {
        status: "IN_PROGRESS",
        completedParts: completedParts as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date()
      }
    });

    return {
      uploadSessionId,
      completedPartNumbers: completedParts.map((part) => part.partNumber)
    };
  }

  async findRecoverableSession(
    user: SessionUser,
    input: { bucket: string; key: string; fileSize: number; partSize: number }
  ) {
    await this.authorizationService.requireBucketPermission(user, input.bucket, "object:upload");

    const bucket = await this.prisma.bucket.findUnique({ where: { name: input.bucket } });
    if (!bucket) {
      return null;
    }

    const existing = await this.prisma.uploadSession.findFirst({
      where: {
        userId: user.id,
        bucketId: bucket.id,
        objectKey: input.key,
        status: {
          in: ["INITIATED", "IN_PROGRESS", "FAILED"]
        },
        expiresAt: {
          gt: new Date()
        },
        partSize: input.partSize,
        fileSize: BigInt(input.fileSize)
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!existing) {
      return null;
    }

    return this.toUploadSessionPublic(existing, bucket.name);
  }

  async listMultipartSessions(
    user: SessionUser,
    input: { status?: Array<"INITIATED" | "IN_PROGRESS" | "FAILED" | "COMPLETED" | "ABORTED">; scope?: "mine" | "all"; limit?: number }
  ) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const where: Prisma.UploadSessionWhereInput = {
      status: input.status?.length ? { in: input.status } : undefined
    };

    if (input.scope === "all" && user.role === "SUPER_ADMIN") {
      where.user = undefined;
    } else if (input.scope === "all" && user.role === "ADMIN") {
      where.bucket = {
        adminScopes: {
          some: {
            adminUserId: user.id
          }
        }
      };
    } else {
      where.userId = user.id;
    }

    const sessions = await this.prisma.uploadSession.findMany({
      where,
      include: {
        bucket: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: limit
    });

    return sessions.map((session) => this.toUploadSessionPublic(session, session.bucket.name));
  }

  async getMultipartSession(user: SessionUser, uploadSessionId: string) {
    const session = await this.getUploadSessionForUser(user, uploadSessionId, true);
    const bucket = await this.prisma.bucket.findUnique({ where: { id: session.bucketId } });
    if (!bucket) {
      throw new NotFoundException("Bucket not found");
    }

    return this.toUploadSessionPublic(session, bucket.name);
  }

  async cleanupExpiredMultipartSessions(actor: SessionUser, limit = 100) {
    if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN") {
      throw new ForbiddenException("Insufficient role");
    }

    const where: Prisma.UploadSessionWhereInput = {
      status: {
        in: ["INITIATED", "IN_PROGRESS"]
      },
      expiresAt: {
        lt: new Date()
      }
    };

    if (actor.role === "ADMIN") {
      where.bucket = {
        adminScopes: {
          some: {
            adminUserId: actor.id
          }
        }
      };
    }

    const expired = await this.prisma.uploadSession.findMany({
      where,
      include: {
        bucket: true
      },
      take: Math.min(Math.max(limit, 1), 500)
    });

    let cleaned = 0;
    for (const session of expired) {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: {
          status: "FAILED",
          error: "Upload session expired",
          lastActivityAt: new Date()
        }
      });
      cleaned += 1;
    }

    return {
      cleaned,
      totalExpired: expired.length
    };
  }

  private async getUploadSessionForUser(user: SessionUser, uploadSessionId: string, allowPrivilegedAccess = false) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: uploadSessionId } });
    if (!session) {
      throw new NotFoundException("Upload session not found");
    }

    if (session.userId !== user.id) {
      const privileged = user.role === "SUPER_ADMIN" || (allowPrivilegedAccess && user.role === "ADMIN");
      if (!privileged) {
        throw new ForbiddenException("Upload session not owned by user");
      }

      if (user.role === "ADMIN") {
        const scope = await this.prisma.adminBucketScope.findFirst({
          where: {
            adminUserId: user.id,
            bucketId: session.bucketId
          },
          select: {
            id: true
          }
        });

        if (!scope) {
          throw new ForbiddenException("ADMIN is not scoped to this upload session bucket");
        }
      }
    }

    if (session.expiresAt < new Date() && session.status !== "COMPLETED" && session.status !== "ABORTED") {
      throw new ForbiddenException("Upload session expired");
    }

    return session;
  }

  private toUploadSessionPublic(
    session: {
      id: string;
      bucketId: string;
      objectKey: string;
      uploadId: string;
      status: "INITIATED" | "IN_PROGRESS" | "COMPLETED" | "ABORTED" | "FAILED";
      partSize: number | null;
      totalParts: number | null;
      fileSize: bigint | null;
      contentType: string | null;
      completedParts: Prisma.JsonValue;
      error: string | null;
      createdAt: Date;
      updatedAt: Date;
      expiresAt: Date;
    },
    bucketName: string
  ) {
    const completed = Array.isArray(session.completedParts)
      ? (session.completedParts as unknown as Array<{ partNumber: number; eTag: string }>)
      : [];

    return {
      id: session.id,
      bucketId: session.bucketId,
      bucketName,
      objectKey: session.objectKey,
      uploadId: session.uploadId,
      status: session.status,
      partSize: session.partSize,
      totalParts: session.totalParts,
      fileSize: session.fileSize?.toString() ?? null,
      contentType: session.contentType,
      completedPartNumbers: completed.map((part) => part.partNumber).sort((a, b) => a - b),
      completedParts: completed
        .filter((part) => Number.isInteger(part.partNumber) && typeof part.eTag === "string")
        .sort((a, b) => a.partNumber - b.partNumber),
      error: session.error,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString()
    };
  }

  private async getS3Client() {
    const conn = await this.connectionsService.getDefaultConnectionWithSecrets();
    return createGarageS3Client({
      endpoint: conn.endpoint,
      region: conn.region,
      forcePathStyle: conn.forcePathStyle,
      accessKeyId: conn.accessKeyId,
      secretAccessKey: conn.secretAccessKey
    });
  }
}
