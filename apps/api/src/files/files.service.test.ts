import { beforeEach, describe, expect, it, vi } from "vitest";

const s3Mocks = vi.hoisted(() => ({
  createGarageS3Client: vi.fn(),
  deleteFileOrFolder: vi.fn(),
  renameFileOrFolder: vi.fn(),
  initMultipartUpload: vi.fn(),
  presignMultipartPart: vi.fn(),
  completeMultipartUpload: vi.fn(),
  abortMultipartUpload: vi.fn(),
  addFolder: vi.fn(),
  getFilePreview: vi.fn(),
  getFolderStats: vi.fn(),
  listFiles: vi.fn(),
  searchFilesAndFolders: vi.fn(),
  MultiPartUpload: vi.fn()
}));

vi.mock("@s3gator/s3", () => ({
  createGarageS3Client: s3Mocks.createGarageS3Client,
  deleteFileOrFolder: s3Mocks.deleteFileOrFolder,
  renameFileOrFolder: s3Mocks.renameFileOrFolder,
  initMultipartUpload: s3Mocks.initMultipartUpload,
  presignMultipartPart: s3Mocks.presignMultipartPart,
  completeMultipartUpload: s3Mocks.completeMultipartUpload,
  abortMultipartUpload: s3Mocks.abortMultipartUpload,
  addFolder: s3Mocks.addFolder,
  getFilePreview: s3Mocks.getFilePreview,
  getFolderStats: s3Mocks.getFolderStats,
  listFiles: s3Mocks.listFiles,
  searchFilesAndFolders: s3Mocks.searchFilesAndFolders,
  MultiPartUpload: s3Mocks.MultiPartUpload
}));

import { FilesService } from "./files.service.js";

const prisma = {
  bucket: {
    findUnique: vi.fn()
  },
  adminBucketScope: {
    findFirst: vi.fn()
  },
  uploadSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  }
};

const connectionsService = {
  getDefaultConnectionWithSecrets: vi.fn()
};

const configService = {
  get: vi.fn((key: string, fallback: unknown) => {
    if (key === "UPLOAD_PART_SIZE_BYTES") {
      return 10 * 1024 * 1024;
    }
    if (key === "UPLOAD_SESSION_TTL_HOURS") {
      return 24;
    }
    return fallback;
  })
};

const authorizationService = {
  requireBucketPermission: vi.fn()
};

const auditService = {
  record: vi.fn()
};

const metricsService = {
  recordS3Failure: vi.fn(),
  recordS3Duration: vi.fn(),
  recordUploadEvent: vi.fn()
};

const user = {
  id: "user-1",
  username: "user1",
  email: "user1@example.com",
  displayName: "User One",
  role: "USER" as const
};

function mockDefaultConnection() {
  connectionsService.getDefaultConnectionWithSecrets.mockResolvedValue({
    id: "conn-1",
    endpoint: "https://garage.example.local",
    region: "garage",
    forcePathStyle: true,
    accessKeyId: "access",
    secretAccessKey: "secret",
    adminApiUrl: null,
    adminToken: null
  });
  s3Mocks.createGarageS3Client.mockReturnValue({ send: vi.fn() });
}

function mockActiveUploadSession() {
  prisma.uploadSession.findUnique.mockResolvedValue({
    id: "upload-session-1",
    userId: "user-1",
    bucketId: "bucket-1",
    objectKey: "folder/file.txt",
    uploadId: "upload-1",
    completedParts: [],
    expiresAt: new Date(Date.now() + 60_000)
  });
}

describe("FilesService hardening", () => {
  let service: FilesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FilesService(
      configService as never,
      prisma as never,
      connectionsService as never,
      authorizationService as never,
      auditService as never,
      metricsService as never
    );
    authorizationService.requireBucketPermission.mockResolvedValue(undefined);
    prisma.adminBucketScope.findFirst.mockResolvedValue({ id: "scope-1" });
    mockDefaultConnection();
  });

  it("writes audit log for object delete", async () => {
    s3Mocks.deleteFileOrFolder.mockResolvedValue({
      bucket: "bucket-a",
      deleted: 1,
      failed: []
    });

    await service.remove(user, { bucket: "bucket-a", key: "file.txt" }, "127.0.0.1");

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "object.delete", ipAddress: "127.0.0.1" })
    );
  });

  it("writes audit log for object rename", async () => {
    s3Mocks.renameFileOrFolder.mockResolvedValue({
      bucket: "bucket-a",
      oldPrefixOrKey: "old.txt",
      newPrefixOrKey: "new.txt",
      copied: 1,
      deleted: 1,
      failed: []
    });

    await service.rename(
      user,
      { bucket: "bucket-a", oldKey: "old.txt", newKey: "new.txt" },
      "127.0.0.1"
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "object.rename", ipAddress: "127.0.0.1" })
    );
  });

  it("initializes multipart upload session", async () => {
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    s3Mocks.initMultipartUpload.mockResolvedValue({
      bucket: "bucket-a",
      key: "folder/file.txt",
      uploadId: "upload-1"
    });
    prisma.uploadSession.create.mockResolvedValue({ id: "upload-session-1" });

    const result = await service.initMultipartSession(user, {
      bucket: "bucket-a",
      key: "folder/file.txt",
      contentType: "text/plain"
    });

    expect(result.uploadSessionId).toBe("upload-session-1");
    expect(result.uploadId).toBe("upload-1");
  });

  it("signs multipart parts and marks session in progress", async () => {
    mockActiveUploadSession();
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    s3Mocks.presignMultipartPart
      .mockResolvedValueOnce({ partNumber: 1, url: "https://upload/1" })
      .mockResolvedValueOnce({ partNumber: 2, url: "https://upload/2" });

    const result = await service.signMultipartParts(user, "upload-session-1", [1, 2]);

    expect(result.parts).toHaveLength(2);
    expect(prisma.uploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "IN_PROGRESS", error: null })
      })
    );
  });

  it("completes multipart upload and writes audit", async () => {
    mockActiveUploadSession();
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    s3Mocks.completeMultipartUpload.mockResolvedValue({
      bucket: "bucket-a",
      key: "folder/file.txt",
      uploadId: "upload-1",
      eTag: "etag"
    });

    const result = await service.completeMultipart(
      user,
      "upload-session-1",
      [
        {
          partNumber: 1,
          eTag: "etag-1"
        }
      ],
      "127.0.0.1"
    );

    expect(result.uploadId).toBe("upload-1");
    expect(prisma.uploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", error: null }) })
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "object.upload.complete" })
    );
  });

  it("aborts multipart upload and marks session aborted", async () => {
    mockActiveUploadSession();
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    s3Mocks.abortMultipartUpload.mockResolvedValue(undefined);

    const result = await service.abortMultipart(user, "upload-session-1", "127.0.0.1");

    expect(result).toEqual({ ok: true, abortError: null });
    expect(prisma.uploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ABORTED" }) })
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "object.upload.abort" })
    );
  });

  it("marks multipart upload as failed and captures abort error", async () => {
    mockActiveUploadSession();
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    s3Mocks.abortMultipartUpload.mockRejectedValue(new Error("abort failed"));

    const result = await service.failMultipart(
      user,
      "upload-session-1",
      "network error",
      "127.0.0.1"
    );

    expect(result.ok).toBe(false);
    expect(result.abortError).toBe("abort failed");
    expect(prisma.uploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "object.upload.failed" })
    );
  });

  it("records completed parts and deduplicates by part number", async () => {
    prisma.uploadSession.findUnique.mockResolvedValue({
      id: "upload-session-1",
      userId: "user-1",
      bucketId: "bucket-1",
      objectKey: "folder/file.txt",
      uploadId: "upload-1",
      completedParts: [
        { partNumber: 1, eTag: "etag-1-old" },
        { partNumber: 2, eTag: "etag-2" }
      ],
      expiresAt: new Date(Date.now() + 60_000)
    });
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });

    const result = await service.recordMultipartPart(user, "upload-session-1", {
      partNumber: 1,
      eTag: "etag-1-new"
    });

    expect(result.completedPartNumbers).toEqual([1, 2]);
    expect(prisma.uploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "IN_PROGRESS",
          completedParts: [
            { partNumber: 1, eTag: "etag-1-new" },
            { partNumber: 2, eTag: "etag-2" }
          ]
        })
      })
    );
  });

  it("returns recoverable multipart session with completed parts", async () => {
    prisma.bucket.findUnique.mockResolvedValue({ id: "bucket-1", name: "bucket-a" });
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: "upload-session-1",
      bucketId: "bucket-1",
      objectKey: "folder/file.txt",
      uploadId: "upload-1",
      status: "IN_PROGRESS",
      partSize: 10 * 1024 * 1024,
      totalParts: 3,
      fileSize: BigInt(25 * 1024 * 1024),
      contentType: "text/plain",
      completedParts: [
        { partNumber: 1, eTag: "etag-1" },
        { partNumber: 2, eTag: "etag-2" }
      ],
      error: null,
      createdAt: new Date("2026-04-09T10:00:00.000Z"),
      updatedAt: new Date("2026-04-09T10:05:00.000Z"),
      expiresAt: new Date(Date.now() + 3600_000)
    });

    const result = await service.findRecoverableSession(user, {
      bucket: "bucket-a",
      key: "folder/file.txt",
      fileSize: 25 * 1024 * 1024,
      partSize: 10 * 1024 * 1024
    });

    expect(result).toMatchObject({
      id: "upload-session-1",
      bucketName: "bucket-a",
      completedPartNumbers: [1, 2],
      completedParts: [
        { partNumber: 1, eTag: "etag-1" },
        { partNumber: 2, eTag: "etag-2" }
      ]
    });
  });
});
