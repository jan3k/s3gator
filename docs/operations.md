# Operations Runbook

Date: 2026-04-10

## Runtime Components

- API (`apps/api`)
- Worker (`apps/api/src/worker.ts`)
- Web (`apps/web`)
- PostgreSQL
- Redis
- Garage S3 + Garage Admin API v2
- Optional OTLP collector (for tracing)

## Required Services in Production

1. PostgreSQL (persistent)
2. Redis (distributed limiter + job locks)
3. API instances (stateless)
4. Worker instances (one or more)
5. Garage S3/Admin endpoints
6. Optional OTLP backend

## API and Worker Startup

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

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Metrics: `GET /metrics`

Main metric families include login, upload, job, S3 error, LDAP failure, retry/reclaim, retention cleanup, retention archive, and scheduler outcomes.

## Job Processing and Timeline

- Job state persists in `jobs` table.
- Worker claim model uses DB transition + Redis lock.
- Timeline events persist in `job_events`.
- Retry metadata persists in job state (`attemptCount`, `maxAttempts`, `nextRetryAt`, `lastError`).
- Retry and reclaim events are persisted in timeline.
- Cancel is best-effort and recorded explicitly in timeline events.

Operational recommendation: monitor stalled `RUNNING` jobs and inspect timeline events before retry/cancel decisions.

## Retention and Archive Maintenance

Retention cleanup windows are configurable by env:

- `RETENTION_JOB_EVENTS_DAYS`
- `RETENTION_FAILED_JOB_DAYS`
- `RETENTION_TERMINAL_JOB_DAYS`
- `RETENTION_AUDIT_LOG_DAYS`
- `RETENTION_SECURITY_AUDIT_DAYS`
- `RETENTION_UPLOAD_SESSION_DAYS`
- `RETENTION_ARCHIVE_ENABLED`
- `RETENTION_ARCHIVE_BATCH_SIZE`

Execution mode:

1. `RETENTION_ARCHIVE_ENABLED=false` -> hard-delete retention (default)
2. `RETENTION_ARCHIVE_ENABLED=true` -> archive+prune for `audit_logs` and `job_events`

Execution paths:

1. Queue maintenance job from admin UI or API (`RETENTION_CLEANUP`)
2. Run direct command:

```bash
npx pnpm maintenance:retention
```

Run one scheduler tick manually (operator validation):

```bash
npx pnpm maintenance:scheduler:run-once
```

## Scheduled Maintenance

Scheduler controls:

- `MAINTENANCE_SCHEDULER_ENABLED`
- `MAINTENANCE_SCHEDULER_TICK_SECONDS`
- `MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS`
- `MAINTENANCE_RETENTION_INTERVAL_MINUTES`
- `MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES`
- `MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES`

Safety model:

1. scheduler runs in-process (API and/or worker where enabled),
2. Redis lock prevents duplicate multi-instance ticks,
3. tasks enqueue into regular job pipeline,
4. active job guard prevents duplicate queue floods for same maintenance job type.

Status endpoint:

- `GET /jobs/maintenance/status` (admin/super-admin)

## Integration Lane Commands

```bash
npx pnpm integration:up
npx pnpm integration:bootstrap
npx pnpm integration:test
npx pnpm integration:reliability
npx pnpm integration:reliability:v2
npx pnpm integration:down
```

What `integration:up` does:

1. starts compose stack,
2. initializes Garage layout/key/bucket/alias,
3. verifies API readiness,
4. runs connection health check,
5. queues and waits for bucket sync,
6. verifies app bucket visibility.

`integration:reliability` validates restart/reclaim behavior by interrupting worker execution mid-job and verifying timeline + terminal-state correctness.

`integration:reliability:v2` runs:

1. baseline reclaim scenario,
2. retry+restart+multi-worker contention scenario on retryable `BUCKET_SYNC` lifecycle.

## Telemetry Runtime Controls

Key environment variables:

- `CORRELATION_HEADER_NAME` (default `x-request-id`)
- `OTEL_ENABLED`
- `OTEL_SERVICE_NAME`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`

See `docs/telemetry.md` for full setup.

## Observability Assets

Reusable assets included in repo:

- Grafana dashboard: `ops/grafana/s3gator-stage6-operations.json`
- Prometheus alert rules: `ops/prometheus/s3gator-alerts.yml`

See `docs/observability-assets.md` for import and usage guidance.

## Known Operational Boundaries

- Rename/delete jobs are durable at job level; no per-object checkpoint resume in-flight.
- Cancellation may wait for in-flight S3 calls to finish.
- Integration bootstrap is deterministic for dev/CI, but production secret lifecycle should be managed separately.
- Archive mode is optional and not a full analytics warehouse; hot queries remain on primary tables.
