# Architecture: Stage 3 (Resilience, Jobs, Operations)

Date: 2026-04-09

## Monorepo

- `apps/api`: NestJS API + Prisma/PostgreSQL
- `apps/web`: Next.js frontend
- `packages/shared`: shared role/permission/types/schema contracts
- `packages/s3`: Garage-compatible S3 + Admin API v2 service layer
- `packages/ui`: shared UI primitives

## Runtime Topology

Recommended production runtime:

1. API instances (stateless)
2. Worker instances (job execution loop)
3. PostgreSQL (system of record)
4. Redis (distributed limiter + runtime locking)
5. Garage S3 endpoint + Garage Admin API v2 endpoint

## Security and Auth

- Local auth (Argon2id) + LDAP auth.
- Auth mode (`local` / `ldap` / `hybrid`) is enforced in `AuthService`.
- Session cookies are HTTP-only; mutating calls require CSRF token.
- Authorization is app-native RBAC + per-bucket permissions.
- `bucket:list` is explicit and required for bucket visibility.
- Scoped admin v2 extends role model:
  - `SUPER_ADMIN`: global
  - `ADMIN`: operationally scoped to assigned buckets for grant and operational views
  - `USER`: explicit per-bucket grants only

## Stage 3 Job System

Persistent job table (`jobs`) with:

- `type`: `FOLDER_RENAME`, `FOLDER_DELETE`, `BUCKET_SYNC`, `UPLOAD_CLEANUP`
- `status`: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`
- actor (`createdByUserId`)
- payload/progress/result/failure summary
- cancellation metadata
- lock metadata (`lockKey`, `lockedAt`)

Execution model:

- API enqueues jobs.
- Worker polls and claims jobs.
- Claiming uses DB state transition and Redis lock.
- Stale-running jobs are reclaimable after lock TTL.
- Cancel is best-effort (checked between units of work).

## Redis Usage

1. Login throttling:
   - distributed key window (`login:<ip>:<username>`)
2. Job coordination:
   - lock key (`job:lock:<jobId>`) via `SET NX EX`

If Redis is disabled in local/test, process-local fallback is used for developer convenience.

## File and Upload Architecture

### File ops

- S3 folders are virtual.
- Folder rename/delete operations are async background jobs.
- File rename/delete remain direct.

### Multipart durability

`upload_sessions` now stores:

- `partSize`, `totalParts`, `fileSize`, `contentType`, `relativePath`
- `completedParts` (partNumber + eTag)
- `lastActivityAt`, `expiresAt`

Resume flow:

1. client asks `/files/multipart/recover`
2. server returns recoverable session + completed parts
3. client uploads only missing parts
4. client records per-part completion (`part-complete`)
5. client completes multipart with merged parts

## Observability

Public operational endpoints:

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

Prometheus metrics include:

- login success/failure + latency
- upload lifecycle events
- job lifecycle events
- S3 failures and latencies
- LDAP auth failures

## Admin Surface

Admin UI now includes:

- background job table (status/progress/failure/cancel)
- upload session visibility
- scoped admin assignment (super-admin only)
- existing Stage 2 controls (users, grants, LDAP, auth mode, connections, audit)

## Testing Lanes

Fast lane:

- workspace unit/service tests
- lightweight Playwright smoke tests (`test/e2e`)

Full integration lane:

- `docker-compose.integration.yml` (Postgres, Redis, Garage, API, Worker, Web)
- integration Playwright suite (`test/e2e-integration`) behind `INTEGRATION_E2E=1`

## Honest Boundaries

- Folder job execution is durable and restart-safe but not per-object checkpoint-resumable mid-run.
- Cancel requests are best-effort for in-flight long S3 calls.
- Full integration upload flows require Garage bootstrap (usable key + bucket alias) in the target environment.
