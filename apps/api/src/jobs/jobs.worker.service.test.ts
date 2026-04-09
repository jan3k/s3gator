import { beforeEach, describe, expect, it, vi } from "vitest";

const s3Mocks = vi.hoisted(() => ({
  createGarageS3Client: vi.fn(),
  deleteFileOrFolder: vi.fn(),
  renameFileOrFolder: vi.fn(),
  GarageAdminApiV2Client: vi.fn()
}));

vi.mock("@s3gator/s3", () => ({
  createGarageS3Client: s3Mocks.createGarageS3Client,
  deleteFileOrFolder: s3Mocks.deleteFileOrFolder,
  renameFileOrFolder: s3Mocks.renameFileOrFolder,
  GarageAdminApiV2Client: s3Mocks.GarageAdminApiV2Client
}));

import { JobsWorkerService } from "./jobs.worker.service.js";

const configService = {
  get: vi.fn((key: string, fallback: unknown) => {
    if (key === "JOB_WORKER_POLL_MS") return 2000;
    if (key === "JOB_LOCK_TTL_SECONDS") return 60;
    if (key === "UPLOAD_CLEANUP_BATCH_SIZE") return 50;
    if (key === "JOB_WORKER_INLINE") return false;
    return fallback;
  })
};

const jobsService = {
  claimNext: vi.fn(),
  isCancelRequested: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  markProgress: vi.fn(),
  markCanceled: vi.fn(),
  recordEvent: vi.fn()
};

const prisma = {
  bucket: {
    upsert: vi.fn()
  },
  uploadSession: {
    findMany: vi.fn(),
    update: vi.fn()
  }
};

const auditService = {
  record: vi.fn()
};

const connectionsService = {
  getDefaultConnectionWithSecrets: vi.fn()
};

const metricsService = {
  recordJobEvent: vi.fn(),
  recordS3Duration: vi.fn(),
  recordS3Failure: vi.fn()
};

describe("JobsWorkerService", () => {
  let service: JobsWorkerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new JobsWorkerService(
      configService as never,
      jobsService as never,
      prisma as never,
      auditService as never,
      connectionsService as never,
      metricsService as never
    );
  });

  it("does nothing when no job is available", async () => {
    jobsService.claimNext.mockResolvedValue(null);

    await service.runOnce();

    expect(jobsService.markCompleted).not.toHaveBeenCalled();
    expect(jobsService.markFailed).not.toHaveBeenCalled();
  });

  it("processes folder delete job and marks completion", async () => {
    jobsService.claimNext.mockResolvedValue({
      id: "job-1",
      type: "FOLDER_DELETE",
      payload: {
        actor: {
          id: "admin-1",
          username: "admin",
          email: "admin@example.com",
          displayName: "Admin",
          role: "ADMIN"
        },
        bucket: "bucket-a",
        key: "folder/",
        ipAddress: "127.0.0.1"
      }
    });
    jobsService.isCancelRequested.mockResolvedValue(false);
    connectionsService.getDefaultConnectionWithSecrets.mockResolvedValue({
      endpoint: "https://garage.example.local",
      region: "garage",
      forcePathStyle: true,
      accessKeyId: "access",
      secretAccessKey: "secret"
    });
    s3Mocks.createGarageS3Client.mockReturnValue({ send: vi.fn() });
    s3Mocks.deleteFileOrFolder.mockResolvedValue({
      bucket: "bucket-a",
      deleted: 2,
      failed: []
    });

    await service.runOnce();

    expect(metricsService.recordJobEvent).toHaveBeenCalledWith("FOLDER_DELETE", "start");
    expect(jobsService.markProgress).toHaveBeenCalled();
    expect(jobsService.recordEvent).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ type: "folder_delete.started" })
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "object.delete",
        entityId: "bucket-a/folder/"
      })
    );
    expect(jobsService.markCompleted).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        deleted: 2,
        mode: "job"
      })
    );
  });
});
