# Maintenance Scheduler

Date: 2026-04-10

## Scope

Stage 7 scheduler remains a lightweight in-process coordinator. It is intentionally not a separate orchestration platform.

## Configuration

Core:

- `MAINTENANCE_SCHEDULER_ENABLED`
- `MAINTENANCE_SCHEDULER_TICK_SECONDS`
- `MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS`

Per task:

- `MAINTENANCE_TASK_RETENTION_ENABLED`
- `MAINTENANCE_TASK_UPLOAD_CLEANUP_ENABLED`
- `MAINTENANCE_TASK_BUCKET_SYNC_ENABLED`
- `MAINTENANCE_RETENTION_INTERVAL_MINUTES`
- `MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES`
- `MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES`

## Coordination Model

1. Scheduler tick runs periodically when enabled.
2. Redis lock (`maintenance:scheduler:tick`) ensures single active leader.
3. Scheduled tasks enqueue through the same jobs pipeline.
4. Active-job guard prevents duplicate queueing for the same maintenance type.

## Operator Visibility

`GET /jobs/maintenance/status` exposes:

- global scheduler heartbeat
- per-task enable state
- per-task last/next run
- last result and trigger (`scheduled` or `manual`)
- last success/failure timestamps
- linked job id + last error

## Manual Trigger

- `POST /jobs/maintenance/tasks/:task/run-once` (`SUPER_ADMIN` only)
- Uses the same lock + active-job guard to stay duplicate-safe.

Local validation command:

```bash
npx pnpm maintenance:scheduler:run-once
```
