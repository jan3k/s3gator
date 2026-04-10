# Architecture: Stage 6 (Archival, Scheduler, Multi-Worker Reliability)

Date: 2026-04-10

## Monorepo

- `apps/api`: NestJS API + Prisma/PostgreSQL
- `apps/web`: Next.js frontend
- `packages/shared`: shared role/permission/types/schema contracts
- `packages/s3`: Garage-compatible S3 + Admin API v2 service layer
- `packages/ui`: shared UI primitives

## Runtime Topology

Recommended production topology:

1. API instances (stateless)
2. Worker instances (job execution)
3. PostgreSQL (system of record)
4. Redis (distributed limiter + locks)
5. Garage S3 + Garage Admin API v2
6. Optional OTLP collector backend for traces

## Security and Auth Model

- Local + LDAP auth with runtime auth mode (`local` / `ldap` / `hybrid`).
- Session cookie auth with CSRF on mutating routes.
- Authorization is app-native RBAC + per-bucket grants.
- Bucket visibility requires explicit `bucket:list` permission.
- Scoped admin v2:
  - `SUPER_ADMIN`: global
  - `ADMIN`: constrained by optional admin-bucket scopes for operational/grant actions
  - `USER`: explicit per-bucket grants only

## Jobs, Retry, and Timeline Model

## Persistent job state

`jobs` table persists:

- `type`: `FOLDER_RENAME`, `FOLDER_DELETE`, `BUCKET_SYNC`, `UPLOAD_CLEANUP`, `RETENTION_CLEANUP`
- `status`: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`
- actor and timing metadata
- progress/result/failure summaries
- cancellation metadata
- `correlationId` for cross-runtime tracing
- retry metadata:
  - `attemptCount`
  - `maxAttempts`
  - `retryable`
  - `nextRetryAt`
  - `lastError`

Retry policy by job type:

- retryable:
  - `BUCKET_SYNC`
  - `UPLOAD_CLEANUP`
  - `RETENTION_CLEANUP`
- non-retryable:
  - `FOLDER_RENAME`
  - `FOLDER_DELETE`

## Event timeline

`job_events` table stores structured lifecycle and domain-step history:

- core events: `created`, `claimed`, `started`, `progress`, `canceled_requested`, `canceled`, `failed`, `completed`
- retry/reclaim events: `retry_scheduled`, `retry_started`, `retry_exhausted`, `retry_skipped_non_retryable`, `reclaimed`
- domain events: e.g. `folder_rename.started`, `bucket_sync.progress`, `upload_cleanup.item_processed`
- event fields: `jobId`, `createdAt`, `level`, `type`, `message`, `metadata`, optional `correlationId`

This is intentionally eventful but bounded; events are meaningful operator diagnostics, not a raw per-object firehose.

## Worker Execution and Cancellation

- Worker claims queued jobs with DB transition + Redis lock.
- Jobs are restart-safe at job-level (reclaimable if stale lock).
- Reclaimed stale runs are explicitly marked in timeline (`reclaimed`) and metrics.
- Cancellation is best-effort:
  - cancel request is persisted,
  - worker checks cancellation between steps/batches,
  - in-flight S3 operations may complete before stop.
- Timeline events explicitly capture cancellation request/observation behavior.
- Retry scheduling is explicit:
  - retryable failures move back to `QUEUED` with `nextRetryAt`,
  - destructive job failures are terminal without retry.

## Operational Retention and Archive Tier

Stage 6 retention maintenance covers:

- `job_events` (different windows for completed/canceled vs failed jobs)
- `audit_logs` (general vs security-relevant windows)
- old terminal jobs
- old terminal upload sessions

Retention execution modes:

1. `hard_delete` (default): Stage 5 behavior
2. `archive_and_prune` (optional):
   - old `audit_logs` rows are copied to `AuditLogArchive` before pruning hot table rows
   - old `job_events` rows are copied to `JobEventArchive` before pruning hot table rows

Hot-path operational queries continue to read primary tables; archive tables are for diagnostics and longer-lived operational history.

Retention is executable via:

- queued maintenance job (`RETENTION_CLEANUP`),
- direct maintenance command (`pnpm maintenance:retention`).

## Scheduled Maintenance

Stage 6 introduces a lightweight in-process scheduler with distributed coordination:

- scheduler tick loop is env-gated (`MAINTENANCE_SCHEDULER_ENABLED`)
- single-leader behavior is enforced with Redis lock (`maintenance:scheduler:tick`)
- scheduled tasks enqueue through the same jobs pipeline (not a separate orchestrator)

Scheduled task set:

- `RETENTION_CLEANUP`
- `UPLOAD_CLEANUP`
- `BUCKET_SYNC` (optional, interval can be `0` to disable)

Scheduler writes per-task run state (`maintenance.scheduler.task.*`) and exposes it through maintenance status API/UI:

- last run,
- next run,
- result (`queued`, `skipped_active`, `failed`),
- linked job ID (if queued),
- last error.

## Multipart Upload Durability

`upload_sessions` persists multipart state including:

- upload id/session id
- part sizing and totals
- completed parts
- relative path for folder uploads
- expiry and last activity metadata

Resume flow:

1. client attempts recover by file key/size/content-type
2. server returns existing active session + completed parts (if available)
3. client uploads missing parts only
4. client marks part completion
5. client completes upload

## Redis Usage

1. Distributed login throttling
2. Job locking (`SET NX EX`) and coordination

Redis can be disabled in local-only paths, but production should keep it enabled for multi-instance correctness.

## Observability

## Metrics

- `GET /metrics` (Prometheus)
- includes login, upload, job, S3 failure, LDAP failure metrics
- Stage 6 metrics include retry/reclaim/retention/scheduler families:
  - `s3gator_job_retries_total`
  - `s3gator_job_reclaims_total`
  - `s3gator_retention_cleanup_total`
  - `s3gator_retention_deleted_records_total`
  - `s3gator_retention_archived_records_total`
  - `s3gator_scheduler_runs_total`

## Health

- `GET /health/live`
- `GET /health/ready`

## Correlation and traces

- API assigns correlation/request ID (`x-request-id` by default).
- Correlation ID flows into:
  - request context,
  - structured logs,
  - audit metadata context,
  - jobs + job events,
  - worker execution context,
  - Garage Admin/S3 operation context where instrumented.
- OpenTelemetry SDK is integrated (OTLP exporter configurable by env).

## Integration Lane Architecture

`docker-compose.integration.yml` runs:

- Postgres
- Redis
- Garage v2.2.0
- API
- Worker
- Web

Bootstrap script (`scripts/integration-bootstrap.mjs`) makes integration deterministic by initializing Garage layout/key/bucket/alias, verifying app connectivity, and running bucket sync.

Reliability lanes:

- `integration:reliability` (Stage 5 baseline):
  1. queue long-running rename job,
  2. interrupt worker container,
  3. wait lock expiry,
  4. restart worker,
  5. verify reclaim + single terminal completion.

- `integration:reliability:v2` (Stage 6):
  1. run baseline reclaim scenario,
  2. run retryable `BUCKET_SYNC` failure/retry scenario,
  3. inject worker restart during retry lifecycle,
  4. force multi-worker contention (secondary worker),
  5. assert coherent timeline and no duplicate terminal event.

## Honest Boundaries

- No ACL/policy/versioning abstraction is introduced (Garage constraints respected).
- Rename/delete durability is job-level, not per-object checkpoint resume.
- Job cancellation remains best-effort for in-flight long operations.
- Archive mode is optional; default deployments can remain hard-delete only.
