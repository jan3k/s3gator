# Archive Governance

Date: 2026-04-10

## Purpose

Stage 7 adds second-level lifecycle governance for archive tables so archive history remains useful but bounded.

## Archive Tables

- `AuditLogArchive`
- `JobEventArchive`

## Policy Windows

Configured by env:

- `ARCHIVE_RETENTION_AUDIT_LOG_DAYS`
- `ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS`
- `ARCHIVE_RETENTION_JOB_EVENT_DAYS`

Security-relevant audit actions are retained longer than general archive audit rows.

## Execution Path

Archive governance runs inside retention cleanup flow (`RETENTION_CLEANUP` job or `maintenance:retention` command):

1. hot retention (hard-delete or archive+prune)
2. archive lifecycle purge according to archive governance windows

## Metrics and Visibility

- `s3gator_archive_governance_deleted_records_total`
- `GET /jobs/maintenance/status` includes retention last-run summary with archive purge counts.

## Boundaries

- Archive tier remains in the same database.
- This is operational governance, not immutable/legal-hold storage.
