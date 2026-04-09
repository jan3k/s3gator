CREATE TYPE "JobType" AS ENUM ('FOLDER_RENAME', 'FOLDER_DELETE', 'BUCKET_SYNC', 'UPLOAD_CLEANUP');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

ALTER TABLE "UploadSession"
  ADD COLUMN "completedParts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "partSize" INTEGER,
  ADD COLUMN "totalParts" INTEGER,
  ADD COLUMN "fileSize" BIGINT,
  ADD COLUMN "contentType" TEXT,
  ADD COLUMN "relativePath" TEXT,
  ADD COLUMN "lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX "UploadSession_status_expiresAt_idx" ON "UploadSession" ("status", "expiresAt");

CREATE TABLE "AdminBucketScope" (
  "id" TEXT PRIMARY KEY,
  "adminUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "bucketId" TEXT NOT NULL REFERENCES "Bucket"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("adminUserId", "bucketId")
);

CREATE TABLE "Job" (
  "id" TEXT PRIMARY KEY,
  "type" "JobType" NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "createdByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "payload" JSONB NOT NULL,
  "progress" JSONB,
  "result" JSONB,
  "failureSummary" TEXT,
  "cancelRequestedAt" TIMESTAMPTZ,
  "lockKey" TEXT,
  "lockedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "Job_status_createdAt_idx" ON "Job" ("status", "createdAt");
CREATE INDEX "Job_createdByUserId_createdAt_idx" ON "Job" ("createdByUserId", "createdAt");
