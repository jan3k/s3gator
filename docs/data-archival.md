# Data Archival Mode

Date: 2026-04-10

## Purpose

Stage 6 adds an optional archive tier to retain operational diagnostics while limiting growth of hot operational tables.

## Archive Tables

- `AuditLogArchive`
- `JobEventArchive`

Hot tables remain:

- `audit_logs`
- `job_events`

## Enable/Disable

- `RETENTION_ARCHIVE_ENABLED=false` (default): hard-delete mode
- `RETENTION_ARCHIVE_ENABLED=true`: archive+prune mode
- `RETENTION_ARCHIVE_BATCH_SIZE` controls copy+delete batch size

## Archive Behavior

When enabled, retention cleanup:

1. selects expired rows
2. inserts archive rows (`source*Id` uniqueness protects against accidental duplicates)
3. deletes source rows from hot tables

Security metadata redaction policy remains unchanged; archive rows preserve already-sanitized payloads.

## Operator Visibility

Maintenance status API/UI exposes:

- archive enabled flag
- archive row counts
- last archive timestamp
- last retention run state
