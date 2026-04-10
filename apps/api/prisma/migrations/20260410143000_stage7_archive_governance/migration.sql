ALTER TABLE "AuditLogArchive"
ADD COLUMN "correlationId" TEXT;

UPDATE "AuditLogArchive"
SET "correlationId" = "metadata" #>> '{_context,correlationId}'
WHERE "metadata" IS NOT NULL
  AND ("metadata" #>> '{_context,correlationId}') IS NOT NULL;

CREATE INDEX "AuditLogArchive_correlationId_createdAt_idx"
ON "AuditLogArchive"("correlationId", "createdAt");
