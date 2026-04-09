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
import { PrismaService } from "@/prisma/prisma.service.js";
import { ConnectionsService } from "@/connections/connections.service.js";
import { AuthorizationService } from "@/authorization/authorization.service.js";
import { AuditService } from "@/audit/audit.service.js";

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectionsService: ConnectionsService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService
  ) {}

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
    const permission: BucketPermission = input.key.endsWith("/") ? "folder:delete" : "object:delete";
    await this.authorizationService.requireBucketPermission(user, input.bucket, permission);

    const s3 = await this.getS3Client();
    const result = await deleteFileOrFolder(s3, input.key, input.bucket);

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
    const permission: BucketPermission = input.oldKey.endsWith("/") ? "folder:rename" : "object:rename";
    await this.authorizationService.requireBucketPermission(user, input.bucket, permission);

    const s3 = await this.getS3Client();
    const result = await renameFileOrFolder(s3, input.oldKey, input.newKey, input.bucket);

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
    input: { bucket: string; key: string; contentType?: string }
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

    const session = await this.prisma.uploadSession.create({
      data: {
        userId: user.id,
        bucketId: bucket.id,
        objectKey: initialized.key,
        uploadId: initialized.uploadId,
        status: "INITIATED",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

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
        partsMeta: partNumbers,
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
        partsMeta: parts as unknown as Prisma.InputJsonValue,
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

  private async getUploadSessionForUser(user: SessionUser, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: uploadSessionId } });
    if (!session) {
      throw new NotFoundException("Upload session not found");
    }

    if (user.role !== "SUPER_ADMIN" && session.userId !== user.id) {
      throw new ForbiddenException("Upload session not owned by user");
    }

    if (session.expiresAt < new Date()) {
      throw new ForbiddenException("Upload session expired");
    }

    return session;
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
