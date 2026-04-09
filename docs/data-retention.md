# Data Retention Policy (Stage 5)

Date: 2026-04-09

## Scope

Stage 5 retention applies to operational data that grows continuously:

- `job_events`
- `audit_logs`
- terminal `jobs`
- terminal `upload_sessions`

Current strategy: hard-delete expired records (no archive-table tier).

## Retention Windows

Configured via environment variables:

- `RETENTION_JOB_EVENTS_DAYS` (default: 30)
- `RETENTION_FAILED_JOB_DAYS` (default: 90)
- `RETENTION_TERMINAL_JOB_DAYS` (default: 30)
- `RETENTION_AUDIT_LOG_DAYS` (default: 180)
- `RETENTION_SECURITY_AUDIT_DAYS` (default: 365)
- `RETENTION_UPLOAD_SESSION_DAYS` (default: 30)

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

## Operational Notes

- Export data externally if compliance requires longer retention than configured windows.
- Keep `RETENTION_SECURITY_AUDIT_DAYS` aligned with incident response and audit requirements.
- For high-volume environments, schedule retention cleanup regularly (daily or multiple times per day).
