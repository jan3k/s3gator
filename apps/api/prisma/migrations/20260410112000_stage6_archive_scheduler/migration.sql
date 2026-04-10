CREATE TABLE "AuditLogArchive" (
  "id" TEXT PRIMARY KEY,
  "sourceAuditLogId" TEXT UNIQUE,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "AuditLogArchive_createdAt_idx" ON "AuditLogArchive" ("createdAt");
CREATE INDEX "AuditLogArchive_archivedAt_idx" ON "AuditLogArchive" ("archivedAt");
CREATE INDEX "AuditLogArchive_action_createdAt_idx" ON "AuditLogArchive" ("action", "createdAt");

CREATE TABLE "JobEventArchive" (
  "id" TEXT PRIMARY KEY,
  "sourceJobEventId" TEXT UNIQUE,
  "jobId" TEXT NOT NULL,
  "jobType" "JobType",
  "jobStatus" "JobStatus",
  "correlationId" TEXT,
  "type" TEXT NOT NULL,
  "level" "JobEventLevel" NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "JobEventArchive_jobId_createdAt_idx" ON "JobEventArchive" ("jobId", "createdAt");
CREATE INDEX "JobEventArchive_type_createdAt_idx" ON "JobEventArchive" ("type", "createdAt");
CREATE INDEX "JobEventArchive_archivedAt_idx" ON "JobEventArchive" ("archivedAt");
CREATE INDEX "JobEventArchive_correlationId_createdAt_idx" ON "JobEventArchive" ("correlationId", "createdAt");
