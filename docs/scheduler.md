# Maintenance Scheduler

Date: 2026-04-10

## Scope

Stage 6 scheduler is a lightweight in-process maintenance coordinator. It is not a separate orchestration platform.

## Configuration

- `MAINTENANCE_SCHEDULER_ENABLED`
- `MAINTENANCE_SCHEDULER_TICK_SECONDS`
- `MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS`
- `MAINTENANCE_RETENTION_INTERVAL_MINUTES`
- `MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES`
- `MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES` (`0` disables scheduled bucket sync)

## Coordination Model

1. scheduler tick runs periodically when enabled
2. Redis lock (`maintenance:scheduler:tick`) ensures single active leader per tick window
3. scheduled tasks enqueue jobs through existing jobs pipeline
4. active queued/running job guard prevents duplicate scheduled floods for same maintenance job type

## Scheduled Jobs

- `RETENTION_CLEANUP` with `reason: scheduled`
- `UPLOAD_CLEANUP` with `reason: scheduled`
- `BUCKET_SYNC` with `reason: scheduled` (optional by interval)

## Status Surface

Maintenance status endpoint/UI provides per-task state:

- last run timestamp
- next run timestamp
- last result (`queued`, `skipped_active`, `failed`)
- linked queued job id
- last error

Manual operator command:

```bash
npx pnpm maintenance:scheduler:run-once
```
