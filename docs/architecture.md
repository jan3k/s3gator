# Architecture: Stage 7 (Archive Governance, Safe Archive Access, Deterministic Reliability CI)

Date: 2026-04-10

## Monorepo

- `apps/api`: NestJS API + Prisma/PostgreSQL + worker logic
- `apps/web`: Next.js admin/file-manager UI
- `packages/shared`: role/permission/types/schema contracts
- `packages/s3`: Garage-compatible S3 + Admin API v2 client layer
- `packages/ui`: shared UI primitives

## Runtime Topology

Recommended production topology:

1. API instances (stateless)
2. Worker instances (job execution + optional scheduler)
3. PostgreSQL (system of record)
4. Redis (distributed limiter + locks)
5. Garage S3 + Garage Admin API v2
6. Optional OTLP collector backend for traces

## Security and Auth Model

- Local + LDAP auth with runtime mode (`local` / `ldap` / `hybrid`).
- Cookie sessions + CSRF for state-changing routes.
- Authorization is app-native RBAC + per-bucket grants.
- Bucket visibility requires explicit `bucket:list`.
- Scoped admin v2:
  - `SUPER_ADMIN`: global
  - `ADMIN`: optional bucket scope constraints
  - `USER`: explicit per-bucket grants

## Jobs, Retry, and Timeline

`jobs` persists lifecycle, retry metadata, correlation id, and progress/result/failure state.

- retryable: `BUCKET_SYNC`, `UPLOAD_CLEANUP`, `RETENTION_CLEANUP`
- non-retryable destructive: `FOLDER_RENAME`, `FOLDER_DELETE`

`job_events` persists operator-meaningful timeline entries including:

- lifecycle (`created`, `claimed`, `started`, `progress_update`, `failed`, `completed`, `canceled*`)
- retry/reclaim (`retry_scheduled`, `retry_started`, `retry_exhausted`, `retry_skipped_non_retryable`, `reclaimed`)
- domain steps (`bucket_sync.*`, `folder_rename.*`, `upload_cleanup.*`, `retention_cleanup.*`)

## Retention, Archive Tier, and Archive Governance

Hot-table retention still supports:

- `hard_delete`
- `archive_and_prune` (`RETENTION_ARCHIVE_ENABLED=true`)

Archive tier tables:

- `AuditLogArchive`
- `JobEventArchive`

Stage 7 adds second-level archive governance windows:

- `ARCHIVE_RETENTION_AUDIT_LOG_DAYS`
- `ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS`
- `ARCHIVE_RETENTION_JOB_EVENT_DAYS`

This keeps archive tables bounded while retaining security-relevant audit history longer than routine records.

## Safe Archive Access

Stage 7 adds read-only archive APIs (SUPER_ADMIN-only):

- `GET /admin/audit/archive`
- `GET /jobs/archive/events`

Both support deterministic sorting (`createdAt desc, id desc`), explicit pagination (`limit`, `offset`), and filters:

- date range (`from`, `to`)
- action/type
- correlation id
- job id (job events)
- severity/level (job events)
- safe text search over bounded fields

Admin UI includes archive browser panels for archived audit logs and archived job events.

## Scheduler Model (Hardened)

Stage 7 scheduler remains in-process and lock-coordinated (no external orchestrator), but now includes stronger governance:

- per-task enable flags:
  - `MAINTENANCE_TASK_RETENTION_ENABLED`
  - `MAINTENANCE_TASK_UPLOAD_CLEANUP_ENABLED`
  - `MAINTENANCE_TASK_BUCKET_SYNC_ENABLED`
- lock TTL safety guard (enforces minimum relative to tick)
- richer task status:
  - `lastResult`, `lastTrigger`
  - `lastSuccessAt`, `lastFailureAt`
  - `lastRunAt`, `nextRunAt`, `lastJobId`, `lastError`
  - task heartbeat and scheduler heartbeat visibility
- safe operator trigger path:
  - `POST /jobs/maintenance/tasks/:task/run-once` (SUPER_ADMIN)
  - duplicate-safe via scheduler lock + active-job guard

All scheduled/manual maintenance paths continue to enqueue into the same jobs pipeline with explicit `reason` metadata.

## Multipart Durability

Multipart upload sessions keep persisted resume state (session id, upload id, completed parts, part sizing, expiry/activity metadata, relative path).

Behavior remains:

- retry and resume for unfinished uploads
- best-effort cancellation/abort semantics
- stale session cleanup via maintenance jobs

## Redis Usage

- distributed login throttling
- job locks and reclaim coordination
- scheduler leader lock coordination

## Observability

### Metrics and health

- `GET /metrics`
- `GET /health/live`
- `GET /health/ready`

Metrics include auth, upload, jobs, retries, reclaims, S3 failures, LDAP failures, retention/archive, archive-governance deletes, and scheduler outcomes.

### Correlation and tracing

- request correlation id (`x-request-id` by default)
- propagation into logs, audit metadata context, jobs and timeline events
- OpenTelemetry export via OTLP env configuration

### Provisioning assets

Stage 7 includes provisioning-oriented assets:

- `ops/grafana/dashboards/*.json`
- `ops/grafana/provisioning/*`
- `ops/prometheus/*.yml`
- `ops/alertmanager/*.yml`

## Integration and Reliability Lanes

`docker-compose.integration.yml` runs PostgreSQL + Redis + Garage + API + Worker + Web.

Bootstrap script (`scripts/integration-bootstrap.mjs`) remains deterministic for dev/integration/CI.

Reliability lanes:

- `integration:reliability`: restart/reclaim baseline
- `integration:reliability:v2`: retry + restart + contention lifecycle
- `integration:reliability:ci`: deterministic CI-oriented run combining v2 plus Stage 7 duplicate-prevention + non-retryable-destructive validations

## Honest Boundaries

- No ACL/policy/versioning abstraction beyond Garage-supported model.
- Rename/delete durability is job-level; no per-object checkpoint resume.
- Job cancel remains best-effort for in-flight operations.
- Archive tier is in the same DB (operational archive, not cold storage/data warehouse).
