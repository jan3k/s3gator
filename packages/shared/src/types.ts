import type { AppRole } from "./roles.js";
import type { BucketPermission } from "./permissions.js";

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: AppRole;
  displayName: string | null;
}

export interface BucketGrant {
  userId: string;
  bucketId: string;
  permissions: BucketPermission[];
}

export interface GarageConnectionPublic {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  adminApiUrl: string | null;
  isDefault: boolean;
  healthStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationQuery {
  limit?: number;
  cursor?: string | null;
}

export type JobType = "FOLDER_RENAME" | "FOLDER_DELETE" | "BUCKET_SYNC" | "UPLOAD_CLEANUP";
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
export type JobEventLevel = "INFO" | "WARN" | "ERROR";

export interface JobProgress {
  totalItems?: number;
  processedItems?: number;
  metadata?: Record<string, unknown>;
}

export interface JobPublic {
  id: string;
  type: JobType;
  status: JobStatus;
  correlationId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  failureSummary: string | null;
  progress: JobProgress | null;
  result: Record<string, unknown> | null;
}

export interface JobEventPublic {
  id: string;
  jobId: string;
  correlationId: string | null;
  type: string;
  level: JobEventLevel;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface JobDetailPublic {
  job: JobPublic;
  events: JobEventPublic[];
}

export interface UploadSessionPublic {
  id: string;
  bucketId: string;
  bucketName: string;
  objectKey: string;
  uploadId: string;
  status: "INITIATED" | "IN_PROGRESS" | "COMPLETED" | "ABORTED" | "FAILED";
  partSize: number | null;
  totalParts: number | null;
  fileSize: string | null;
  contentType: string | null;
  completedPartNumbers: number[];
  completedParts: Array<{ partNumber: number; eTag: string }>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
