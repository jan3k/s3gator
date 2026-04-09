# Operations Runbook

Date: 2026-04-09

## Runtime Components

- API (`apps/api`)
- Worker (`apps/api/src/worker.ts`)
- Web (`apps/web`)
- PostgreSQL
- Redis
- Garage S3 + Garage Admin API v2

## Required Services in Production

1. PostgreSQL (persistent)
2. Redis (shared for distributed limiter + job locks)
3. API instances (stateless)
4. Worker instances (one or more)
5. Garage S3 endpoint and Admin API v2 endpoint

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

## Job Processing Model

- Job state is persisted in PostgreSQL (`jobs` table).
- Worker claims jobs via DB transition (`QUEUED` -> `RUNNING`) plus Redis lock key.
- Stale `RUNNING` jobs can be re-claimed after lock TTL.
- Supported states: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`.

## Health and Metrics

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Prometheus metrics: `GET /metrics`

Main metric families:
- `s3gator_login_total`
- `s3gator_upload_events_total`
- `s3gator_jobs_total`
- `s3gator_s3_failures_total`
- `s3gator_ldap_auth_failures_total`

## Multipart Session Maintenance

- Upload session durability is persisted in `upload_sessions`.
- Expired in-progress sessions can be cleaned by:
  - background `UPLOAD_CLEANUP` jobs, or
  - admin endpoint `POST /files/multipart/cleanup-expired`.

## Integration Stack

Use:

```bash
npx pnpm integration:up
npx pnpm integration:down
```

The integration compose file includes Garage, but Garage cluster/key/bucket bootstrap may still require environment-specific initialization before upload E2E flows.
