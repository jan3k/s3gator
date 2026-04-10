# Scheduler Operations

Date: 2026-04-10

## Core Controls

- `MAINTENANCE_SCHEDULER_ENABLED`
- `MAINTENANCE_SCHEDULER_TICK_SECONDS`
- `MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS`

## Per-task Controls

- `MAINTENANCE_TASK_RETENTION_ENABLED`
- `MAINTENANCE_TASK_UPLOAD_CLEANUP_ENABLED`
- `MAINTENANCE_TASK_BUCKET_SYNC_ENABLED`
- `MAINTENANCE_RETENTION_INTERVAL_MINUTES`
- `MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES`
- `MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES`

## Safety Guarantees

- single-leader tick coordination via Redis lock
- active-job guard per maintenance job type
- manual run-once path uses same lock/guard model

## Status Surfaces

- `GET /jobs/maintenance/status`
- admin UI maintenance table (task enabled/state, last success/failure, next run, last job)

## Manual Trigger

- `POST /jobs/maintenance/tasks/:task/run-once` (`SUPER_ADMIN` only)
- Result states: `queued`, `skipped_active`, `failed`, `skipped_disabled`

## Notes

- "Run once" is duplicate-safe by design but still asynchronous (it queues jobs, not inline execution).
