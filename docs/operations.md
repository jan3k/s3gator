# Operations Runbook

Date: 2026-04-10

## Runtime Components

- API (`apps/api`)
- Worker (`apps/api/src/worker.ts`)
- Web (`apps/web`)
- PostgreSQL
- Redis
- Garage S3 + Garage Admin API v2
- Optional OTLP collector

## Required Services in Production

1. PostgreSQL (persistent)
2. Redis (distributed limiter + lock coordination)
3. API instances
4. Worker instances
5. Garage S3/Admin endpoints
6. Optional OTLP backend

## Startup

Local:

```bash
npx pnpm dev
npx pnpm dev:worker
```

Production build path:

```bash
npx pnpm build
npx pnpm --filter @s3gator/api start
npx pnpm --filter @s3gator/api start:worker
```

## Health and Metrics

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

## Retention, Archive, and Archive Governance

Hot retention controls:

- `RETENTION_JOB_EVENTS_DAYS`
- `RETENTION_FAILED_JOB_DAYS`
- `RETENTION_TERMINAL_JOB_DAYS`
- `RETENTION_AUDIT_LOG_DAYS`
- `RETENTION_SECURITY_AUDIT_DAYS`
- `RETENTION_UPLOAD_SESSION_DAYS`
- `RETENTION_ARCHIVE_ENABLED`
- `RETENTION_ARCHIVE_BATCH_SIZE`

Stage 7 archive governance controls:

- `ARCHIVE_RETENTION_AUDIT_LOG_DAYS`
- `ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS`
- `ARCHIVE_RETENTION_JOB_EVENT_DAYS`

Modes:

1. `RETENTION_ARCHIVE_ENABLED=false` -> hard-delete hot retention
2. `RETENTION_ARCHIVE_ENABLED=true` -> archive-and-prune hot tables + archive governance lifecycle

Execution paths:

```bash
npx pnpm maintenance:retention
```

or queue via admin/jobs API.

## Scheduler (Hardened)

Core controls:

- `MAINTENANCE_SCHEDULER_ENABLED`
- `MAINTENANCE_SCHEDULER_TICK_SECONDS`
- `MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS`

Per-task controls:

- `MAINTENANCE_TASK_RETENTION_ENABLED`
- `MAINTENANCE_TASK_UPLOAD_CLEANUP_ENABLED`
- `MAINTENANCE_TASK_BUCKET_SYNC_ENABLED`
- `MAINTENANCE_RETENTION_INTERVAL_MINUTES`
- `MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES`
- `MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES`

Safety model:

1. Redis lock elects one active scheduler tick leader.
2. Tasks enqueue through existing jobs pipeline.
3. Active job guard prevents duplicate queue floods.
4. Manual run-once uses same lock + guard for duplicate safety.

Status endpoint:

- `GET /jobs/maintenance/status`

Manual run-once API (SUPER_ADMIN):

- `POST /jobs/maintenance/tasks/:task/run-once`

Manual scheduler tick command:

```bash
npx pnpm maintenance:scheduler:run-once
```

## Archive Browse Operations

SUPER_ADMIN-only archive APIs:

- `GET /admin/audit/archive`
- `GET /jobs/archive/events`

Supported query controls include:

- `limit`, `offset`
- `from`, `to`
- action/type filters
- correlation id
- job id / level (job events)
- safe text search fields

## Integration and Reliability Lanes

```bash
npx pnpm integration:up
npx pnpm integration:bootstrap
npx pnpm integration:test
npx pnpm integration:reliability
npx pnpm integration:reliability:v2
npx pnpm integration:reliability:ci
npx pnpm integration:down
```

`integration:reliability:ci` runs:

1. Stage 6 reliability v2 baseline (retry + restart + contention + reclaim)
2. Stage 7 deterministic checks:
   - duplicate-safe maintenance run-once contention
   - destructive job remains non-retryable
   - no duplicate terminal event invariant

Key CI/reliability knobs:

- `INTEGRATION_JOB_LOCK_TTL_SECONDS`
- `INTEGRATION_RELIABILITY_V2_WAIT_FOR_RETRY_MS`
- `INTEGRATION_RELIABILITY_V2_WAIT_FOR_COMPLETION_MS`
- `INTEGRATION_RELIABILITY_CI_CONTENTION_CALLS`
- `INTEGRATION_RELIABILITY_CI_WAIT_FOR_TERMINAL_MS`

## Observability Assets and Provisioning

Assets:

- `ops/grafana/dashboards/s3gator-stage7-operations.json`
- `ops/grafana/provisioning/dashboards/s3gator-dashboards.yml`
- `ops/grafana/provisioning/datasources/s3gator-prometheus.yml`
- `ops/prometheus/s3gator-alerts.yml`
- `ops/alertmanager/s3gator-routing.example.yml`

Validation command:

```bash
npx pnpm ops:validate-assets
```

## Known Operational Boundaries

- Rename/delete jobs are durable at job level only (no per-object checkpoint resume).
- Cancellation remains best-effort for in-flight S3 calls.
- Archive tier is in the same DB; treat it as operational archive, not immutable cold storage.
- Integration bootstrap remains dev/integration/CI-oriented and not a production secret lifecycle tool.
