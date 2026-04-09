# Operations Runbook

Date: 2026-04-09

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

Main metric families include login, upload, job, S3 error, and LDAP failure signals.

## Job Processing and Timeline

- Job state persists in `jobs` table.
- Worker claim model uses DB transition + Redis lock.
- Timeline events persist in `job_events`.
- Cancel is best-effort and recorded explicitly in timeline events.

Operational recommendation: monitor stalled `RUNNING` jobs and inspect timeline events before retry/cancel decisions.

## Integration Lane Commands

```bash
npx pnpm integration:up
npx pnpm integration:bootstrap
npx pnpm integration:test
npx pnpm integration:down
```

What `integration:up` does:

1. starts compose stack,
2. initializes Garage layout/key/bucket/alias,
3. verifies API readiness,
4. runs connection health check,
5. queues and waits for bucket sync,
6. verifies app bucket visibility.

## Telemetry Runtime Controls

Key environment variables:

- `CORRELATION_HEADER_NAME` (default `x-request-id`)
- `OTEL_ENABLED`
- `OTEL_SERVICE_NAME`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`

See `docs/telemetry.md` for full setup.

## Known Operational Boundaries

- Rename/delete jobs are durable at job level; no per-object checkpoint resume in-flight.
- Cancellation may wait for in-flight S3 calls to finish.
- Integration bootstrap is deterministic for dev/CI, but production secret lifecycle should be managed separately.
