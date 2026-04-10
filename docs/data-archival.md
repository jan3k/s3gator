# Data Archival Mode

Date: 2026-04-10

## Purpose

Archive mode keeps longer-lived operational diagnostics while controlling hot-table growth.

## Archive Tables

- `AuditLogArchive`
- `JobEventArchive`

## Hot-to-Archive Mode

Controlled by:

- `RETENTION_ARCHIVE_ENABLED`
- `RETENTION_ARCHIVE_BATCH_SIZE`

Behavior:

1. select expired hot rows
2. copy into archive tables
3. prune copied hot rows

## Stage 7 Archive Governance

Archive tables now have second-level lifecycle windows:

- `ARCHIVE_RETENTION_AUDIT_LOG_DAYS`
- `ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS`
- `ARCHIVE_RETENTION_JOB_EVENT_DAYS`

This keeps archive bounded while retaining security-relevant audit rows longer.

## Access Model

Archive browsing is read-only and limited to `SUPER_ADMIN` via:

- `GET /admin/audit/archive`
- `GET /jobs/archive/events`

## Notes

- Archive rows keep redacted/safe metadata policy.
- Archive is operational storage in same DB, not immutable cold storage.
