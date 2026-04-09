DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'JobType'
      AND e.enumlabel = 'RETENTION_CLEANUP'
  ) THEN
    ALTER TYPE "JobType" ADD VALUE 'RETENTION_CLEANUP';
  END IF;
END $$;

ALTER TABLE "Job"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "nextRetryAt" TIMESTAMPTZ,
  ADD COLUMN "lastError" TEXT;

CREATE INDEX "Job_status_nextRetryAt_idx" ON "Job" ("status", "nextRetryAt");
