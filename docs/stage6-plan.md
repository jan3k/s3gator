# Stage 6 Plan: Archival, Scheduled Maintenance, and Multi-Worker Reliability

Date: 2026-04-10

## Scope

Stage 6 extends the existing Stage 5 architecture without stack replacement.

Primary outcomes:

1. optional archive tier for operational history,
2. automatic scheduled maintenance via existing job pipeline,
3. reliability lane v2 covering retry + restart + contention,
4. ready-to-import observability assets,
5. clearer maintenance/archive operator visibility.

## Stage 5 Limitations Addressed

1. Retention is hard-delete only; no archive tier.
2. Retention and stale upload cleanup are mostly manual.
3. Reliability lane validates reclaim/restart but not retry + contention interactions.
4. Metrics exist but no reusable dashboard/alert assets in-repo.
5. Operators do not have a compact maintenance state surface (last run / scheduler state / archive mode).

## Archive Strategy

Chosen model: optional DB archive tables.

- `AuditLogArchive`
- `JobEventArchive`

Behavior modes:

- `archive disabled` (default): Stage 5 hard-delete behavior remains unchanged.
- `archive enabled`: retention flow moves eligible records to archive tables, then prunes hot tables.

Design guardrails:

- archive rows store already-redacted metadata (no secret bypass),
- archive tables are append-only operational history, not analytics warehouse,
- hot-path queries remain on primary tables,
- archive access is exposed as operational status/counters, not broad end-user browsing.

## Scheduler Strategy

Chosen model: lightweight in-process scheduler service using Redis lock coordination.

- scheduler runs in existing Nest runtime (API/worker context) when enabled,
- each task uses Redis lock keys to avoid duplicate multi-instance scheduling floods,
- tasks enqueue the same background jobs with `reason: scheduled` metadata,
- task run state stored in `AppSetting` for visibility.

Scheduled tasks (minimum):

- retention cleanup job
- upload cleanup job

Optional scheduled bucket sync:

- enabled by interval env if configured (>0)

State visibility:

- last run / next run / last result / last error / last job id per task,
- retention last-run state and archive stats surfaced via maintenance status API.

## Reliability-v2 Scenarios

Reliability v2 script validates real process behavior:

1. stale-lock reclaim path (restart during long folder rename),
2. retryable job failure path (`BUCKET_SYNC` with temporary invalid Admin API URL),
3. worker restart in retry lifecycle,
4. multi-worker contention via additional worker container,
5. no duplicate terminal event for tested jobs,
6. timeline contains expected reclaim/retry events.

## Observability Asset Strategy

Add repo assets:

- `ops/grafana/s3gator-operations-stage6.json`
- `ops/grafana/s3gator-stage6-operations.json`
- `ops/prometheus/s3gator-alerts.yml`

Coverage includes:

- login failures,
- job fail/retry/reclaim,
- upload failure,
- readiness degradation,
- retention cleanup success/failure,
- S3 and LDAP error trends.

## Rollout Risks

1. Archive mode migration/retention loops could increase DB IO.
   - mitigation: batch-size controls + bounded loops.

2. Misconfigured scheduler intervals can over-enqueue jobs.
   - mitigation: interval validation + lock coordination + explicit status visibility.

3. Reliability-v2 script runtime variability in slower CI environments.
   - mitigation: configurable timeouts and clear invariant failures.

4. Archive table growth without external lifecycle policy.
   - mitigation: document archival governance and optional future external export.

## Out of Scope (Intentional)

- full analytics warehouse over archived operational data,
- per-object checkpoint resume for folder rename/delete,
- hard-cancel guarantees for in-flight S3 calls,
- introducing heavyweight workflow/orchestration platform.
