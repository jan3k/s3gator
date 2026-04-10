# Data Retention Policy (Stage 6)

Date: 2026-04-10

## Scope

Stage 6 retention applies to operational data that grows continuously:

- `job_events`
- `audit_logs`
- terminal `jobs`
- terminal `upload_sessions`

Current strategy: hard-delete expired records (no archive-table tier).
Stage 6 adds optional archive+prune mode.

## Retention Windows

Configured via environment variables:

- `RETENTION_JOB_EVENTS_DAYS` (default: 30)
- `RETENTION_FAILED_JOB_DAYS` (default: 90)
- `RETENTION_TERMINAL_JOB_DAYS` (default: 30)
- `RETENTION_AUDIT_LOG_DAYS` (default: 180)
- `RETENTION_SECURITY_AUDIT_DAYS` (default: 365)
- `RETENTION_UPLOAD_SESSION_DAYS` (default: 30)
- `RETENTION_ARCHIVE_ENABLED` (default: `false`)
- `RETENTION_ARCHIVE_BATCH_SIZE` (default: `500`)

Safety rules:

1. failed-job diagnostics are retained longer than normal job events,
2. security-relevant audit actions are retained longer than general audit entries,
3. running/queued jobs are not deleted by retention cleanup.

## Execution Paths

1. Queue retention cleanup as background job (`RETENTION_CLEANUP`) via admin/API
2. Run direct maintenance command:

```bash
npx pnpm maintenance:retention
```

3. Use scheduled maintenance (if enabled) for automatic retention runs:

- `MAINTENANCE_SCHEDULER_ENABLED=true`
- `MAINTENANCE_RETENTION_INTERVAL_MINUTES=<interval>`

## Archive Mode

When `RETENTION_ARCHIVE_ENABLED=true`:

1. expired `audit_logs` rows are copied to `AuditLogArchive` then removed from hot table
2. expired `job_events` rows are copied to `JobEventArchive` then removed from hot table

Archive goals:

- retain diagnostic history longer without unbounded hot-table growth
- preserve redacted/safe metadata model
- keep primary-table queries focused on active operational data

When disabled, Stage 5 hard-delete behavior remains unchanged.

## Operational Notes

- Export data externally if compliance requires longer retention than configured windows or cross-system reporting.
- Keep `RETENTION_SECURITY_AUDIT_DAYS` aligned with incident response and audit requirements.
- For high-volume environments, keep scheduler enabled and tune interval/batch size to avoid burst DB load.
