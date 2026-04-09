CREATE TYPE "JobEventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

ALTER TABLE "Job"
  ADD COLUMN "correlationId" TEXT;

CREATE TABLE "JobEvent" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "Job"("id") ON DELETE CASCADE,
  "correlationId" TEXT,
  "type" TEXT NOT NULL,
  "level" "JobEventLevel" NOT NULL DEFAULT 'INFO',
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "Job_correlationId_createdAt_idx" ON "Job" ("correlationId", "createdAt");
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent" ("jobId", "createdAt");
CREATE INDEX "JobEvent_type_createdAt_idx" ON "JobEvent" ("type", "createdAt");
CREATE INDEX "JobEvent_correlationId_createdAt_idx" ON "JobEvent" ("correlationId", "createdAt");
