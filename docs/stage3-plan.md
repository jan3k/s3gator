# Stage 3 Plan: Resilience, Jobs, and Production Operations

Date: 2026-04-09

## Scope

Stage 3 extends the existing Stage 2-hardened architecture in-place. No framework or stack replacement.

Primary maturity goals:
- move heavy operations to persistent background jobs,
- add distributed runtime primitives with Redis,
- improve upload durability with practical multipart resume,
- expose real health/readiness/metrics endpoints,
- provide a fuller integration lane with Docker + Garage + Redis + DB,
- add scoped admin controls for operational actions.

## Architecture Decisions

## 1) Background jobs: DB-backed state + worker loop

Decision:
- Add persistent `Job` records in PostgreSQL.
- Add `JobsService` for enqueue/list/detail/cancel.
- Add `JobsWorkerService` process loop for claim/execute/finalize.
- Run worker in a dedicated process entrypoint (`pnpm --filter @s3gator/api worker`) and optionally in API process for dev convenience.

Why:
- Keeps architecture simple (Nest + Prisma) while providing durable state and restart-safe processing.

Out-of-scope for Stage 3:
- heavyweight orchestration platform,
- full DAG/workflow engine.

## 2) Distributed coordination: Redis

Decision:
- Introduce Redis module and shared client service.
- Replace in-memory login limiter with Redis-backed counters + TTL.
- Use Redis lock keys for job execution guard (`SET NX EX`) in addition to DB claim semantics.

Why:
- Supports multi-instance correctness for throttling and worker coordination.

## 3) Multipart resume model

Decision:
- Extend upload session model with persisted file/session metadata and completed part tracking.
- Add endpoints for:
  - listing resumable sessions,
  - reading session details,
  - recording completed part(s),
  - recovering existing active session by bucket/key/size/partSize,
  - stale session cleanup.
- Frontend resumes missing parts for matching existing session (same key + file shape) instead of restarting from zero.

Boundaries:
- Browser crash/restart resume requires user to re-select the file(s); binary content is not persisted in browser by the app.

## 4) Observability

Decision:
- Add dedicated `HealthController` with:
  - `GET /health/live`
  - `GET /health/ready`
- Add Prometheus-compatible metrics endpoint (`GET /metrics`) using `prom-client`.
- Instrument counters/histograms for auth, uploads, jobs, LDAP failures, S3 failures.

## 5) Scoped admin v2

Decision:
- Add optional admin-bucket scope mapping table.
- Keep role model unchanged (`SUPER_ADMIN`, `ADMIN`, `USER`).
- Enforce ADMIN bucket-scoped limitations for admin bucket operations.
- Add endpoints/UI for super-admin scope assignment.

## 6) Integration test lanes

Decision:
- Keep current fast lane (unit + lightweight Playwright).
- Add full integration lane with compose services: Postgres, Redis, Garage v2.2.0, API, web.
- Add backend-integrated Playwright scenario set for core flows.

## Job Model

Proposed job types:
- `FOLDER_RENAME`
- `FOLDER_DELETE`
- `BUCKET_SYNC`
- `UPLOAD_CLEANUP` (maintenance)

Statuses:
- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELED`

Stored data:
- type, status, createdBy, timestamps,
- payload,
- progress (`totalItems`, `processedItems`, `metadata`),
- result summary and failure info,
- cancel request marker.

## Redis Usage Plan

- Login limiter:
  - key: `s3gator:login:<ip>:<username>`
  - `INCR` + `EXPIRE` in configured window.
- Job locks:
  - key: `s3gator:job:lock:<jobId>`
  - `SET NX EX` per running attempt.

## Multipart Resume Plan

- Persist `partSize`, `fileSize`, `contentType`, `totalParts`, and completed part list.
- Client flow:
  1. discover recoverable session,
  2. sign missing parts only,
  3. upload missing parts,
  4. record parts + complete.
- Cleanup:
  - scheduled worker cleanup + admin endpoint for stale uploads.

## Test Strategy

Fast lane (default):
- unit/service tests for job lifecycle, limiter behavior with Redis mock, multipart resume logic, scoped admin checks, health/metrics endpoint tests.

Full integration lane:
- docker-compose integration stack,
- Playwright backend-integrated flows:
  - local login,
  - bucket visibility by `bucket:list`,
  - upload + post-upload listing,
  - rename/delete via jobs,
  - admin grant update,
  - bucket sync and job visibility.

## Migration / Rollout Risks

- New DB schema (jobs/admin scopes/upload metadata) requires migration before rollout.
- Worker must be deployed and supervised alongside API.
- Redis connectivity is now operationally important for distributed behavior.
- Background jobs introduce eventual consistency in UI for async operations.

## Intentionally Out of Scope

- Complex workflow engine or external queue platform migration.
- Full resumability without file reselection after browser restart.
- Full tracing mesh and distributed telemetry backend setup.

