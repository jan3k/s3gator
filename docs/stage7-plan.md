# Stage 7 Plan: Archive Governance, Safe Archive Access, and Deterministic Reliability in CI

## Stage 6 Limitations Addressed
- Archive tier exists (`AuditLogArchive`, `JobEventArchive`) but has no second-level lifecycle policy.
- Archive records are not browseable through safe, role-guarded API/UI.
- Scheduler visibility is basic (`lastResult` snapshot only) and lacks safe operator-triggered run-once controls.
- Reliability v2 lane is useful but still timing-sensitive for CI and does not validate scheduled-task duplicate prevention deterministically.
- Observability assets exist, but provisioning/routing templates are not turnkey.

## Scope
- Keep Stage 1-6 architecture intact.
- Extend existing jobs/maintenance modules and admin UI.
- Keep all archive browsing read-only and SUPER_ADMIN-only.
- Preserve best-effort cancellation semantics (no hard-cancel claims).

## Archive Governance Model
- Keep Stage 6 hot->archive step unchanged (`RETENTION_ARCHIVE_ENABLED` controls archive-and-prune from hot tables).
- Add second-level archive retention windows:
  - `ARCHIVE_RETENTION_AUDIT_LOG_DAYS`
  - `ARCHIVE_RETENTION_JOB_EVENT_DAYS`
  - `ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS` (longer window for security-sensitive audit actions)
- Add optional security record protection for archive purge by action prefixes (`auth.`, `user.`, `settings.`, `connection.`, `session.`, `bucket.grants`, `admin.scope`).
- Add archive governance execution as part of retention cleanup job summary and metrics.
- Keep default behavior safe: conservative defaults, explicit env configuration, no silent aggressive purge.

## Archive Access Model
- Add read-only archive APIs:
  - `GET /admin/audit/archive`
  - `GET /jobs/archive/events`
- Required controls:
  - pagination (`limit`, `offset`)
  - deterministic sorting (createdAt desc, id desc)
  - filters: date range, action/type, correlationId, jobId, level, search (safe fields only)
- Role policy:
  - SUPER_ADMIN only (ADMIN archive access intentionally out of scope for Stage 7 due to cross-bucket data sensitivity).
- Response shaping:
  - explicit DTO-like objects, no raw Prisma rows with sensitive internals.

## Scheduler Hardening Model
- Extend scheduler task state with:
  - `lastSuccessAt`
  - `lastFailureAt`
  - `lastHeartbeatAt`
  - explicit `taskEnabled` flag per task
- Add config validation safeguards:
  - prevent invalid/too-low tick/TTL combinations from causing duplicate floods.
- Add safe operator control endpoints (SUPER_ADMIN):
  - trigger run-once for a task (`manual`) with duplicate-active guard.
- Preserve existing enqueue path via `JobsService` and metadata (`reason: manual|scheduled`).

## Deterministic Reliability / CI Strategy
- Keep current reliability lane and add deterministic CI lane script.
- Add deterministic knobs via env:
  - explicit poll intervals, lock TTL, wait windows
  - bounded retries/timeouts
- Add lane validation for:
  - retry + restart
  - reclaim
  - contention
  - non-retryable destructive jobs remain non-retryable
  - scheduled task duplicate prevention under contention
- Provide dedicated script target for CI execution.

## Observability Provisioning Strategy
- Keep existing metrics and dashboards; reorganize assets for provisioning:
  - `ops/grafana/dashboards/`
  - `ops/grafana/provisioning/`
  - `ops/prometheus/`
  - `ops/alertmanager/`
- Provide:
  - dashboard provider YAML
  - datasource/template notes
  - alert rules and Alertmanager route example
- Ensure alert expressions match actual metric names already emitted by app.

## Rollout Risks
- Archive query filters can become expensive on large archive tables without indexes.
  - Mitigation: add pragmatic indexes for common filter dimensions.
- Scheduler manual trigger could enqueue duplicates under race.
  - Mitigation: active-job guard + scheduler lock + idempotent state updates.
- CI reliability lane can still be flaky if host Docker is slow.
  - Mitigation: wider bounded waits and explicit readiness checks.

## Out of Scope
- Moving archive tier to separate physical database/object storage.
- Compliance/legal hold framework.
- Per-object checkpoint resume for rename/delete.
- Immediate hard cancellation of in-flight S3 calls.
- Full in-repo monitoring stack deployment.
