# Stage 5 Plan: Retention, Retry, and Reliability Validation

Date: 2026-04-09

## Scope

Stage 5 extends the existing Stage 4 architecture without stack replacement. Focus areas:

1. Operational data lifecycle (retention + safe cleanup)
2. Job retry discipline with per-job-type policy
3. Worker restart/reclaim reliability validation
4. SLI/SLO-oriented operational visibility on top of existing metrics/traces
5. Operator/admin visibility for retry/reliability state

## Stage 4 Limitations Addressed

1. `job_events` and `audit_logs` growth is unbounded.
2. Job retries are implicit/minimal and not policy-driven.
3. Restart/reclaim behavior exists but is not validated with a realistic interruption path.
4. Metrics exist but are not explicitly mapped to operator SLI/SLO interpretation.
5. Admin jobs view lacks retry context (attempts, schedule, exhaustion).

## Retention Strategy

Chosen approach: **Option A (hard-delete after retention windows)** with safety windows.

Why:
- keeps schema/query model simple,
- avoids archive-table complexity in Stage 5,
- provides deterministic operational bounds.

Retention classes:

- `job_events`:
  - completed/canceled job events retained for `RETENTION_JOB_EVENTS_DAYS`
  - failed job events retained for longer `RETENTION_FAILED_JOB_DAYS`
  - running/queued job events are not eligible for retention deletion

- `audit_logs`:
  - general events retained for `RETENTION_AUDIT_LOG_DAYS`
  - security-relevant events retained for longer `RETENTION_SECURITY_AUDIT_DAYS`

Additional practical cleanup:
- old terminal jobs (`COMPLETED`/`CANCELED` and older failed jobs) pruned by retention policy
- old terminal upload session records pruned by retention policy

Execution model:
- new background job type `RETENTION_CLEANUP` for operator-triggered cleanup
- optional direct maintenance command for scripted operations

## Retry Strategy Per Job Type

Job retry metadata added on `Job`:
- `attemptCount`
- `maxAttempts`
- `retryable`
- `nextRetryAt`
- `lastError`

Policy by job type:

- `BUCKET_SYNC`: retryable, bounded attempts, exponential backoff
- `UPLOAD_CLEANUP`: retryable, bounded attempts, exponential backoff
- `FOLDER_RENAME`: **non-retryable** (destructive/idempotency-sensitive)
- `FOLDER_DELETE`: **non-retryable** (destructive/idempotency-sensitive)
- `RETENTION_CLEANUP`: retryable with low bounded attempts

Lifecycle/event behavior:
- emit timeline events for `retry_scheduled`, `retry_started`, `retry_exhausted`, `retry_skipped_non_retryable`
- keep correlation IDs consistent across attempts
- terminal failure occurs only after retry exhaustion (for retryable jobs)

## Reclaim/Restart Reliability Strategy

Enhancements:
- explicit timeline visibility for stale-run reclaim (`reclaimed` event)
- claim/started events include attempt metadata

Validation path:
- add reliability lane script that:
  1. starts integration stack,
  2. bootstraps Garage/app,
  3. queues long-running folder job,
  4. kills worker container during execution,
  5. restarts worker,
  6. validates reclaim and final terminal state via API timeline,
  7. validates no duplicate terminal completion.

Also add focused unit tests for retry/reclaim state transitions.

## SLI/SLO Strategy

Define practical Stage 5 SLIs (documentation + metric mapping):

- Login success rate
- Upload completion rate
- Job success/failure and retry exhaustion rate
- Bucket sync success rate
- Readiness availability

Implementation:
- extend existing metrics with retry/reclaim/retention signals
- document example Prometheus queries and alert suggestions

No in-repo full monitoring platform build-out in Stage 5.

## API/UI Impact

Backend:
- job DTOs expanded with retry metadata
- manual retention cleanup job enqueue endpoint

Admin UI:
- show retryability, attempt counters, next retry time, exhaustion status
- timeline remains primary diagnostics source for restart/retry behavior

## Rollout Risks

1. Retention windows too aggressive could remove useful diagnostics.
   - mitigation: conservative defaults + security-event longer retention window.

2. Retry of wrong job types could cause duplicate destructive operations.
   - mitigation: destructive jobs marked non-retryable by policy.

3. Reliability script timing sensitivity in slower environments.
   - mitigation: configurable wait/timeout env knobs and clear fail messages.

4. Migration compatibility with existing Stage 4 data.
   - mitigation: additive nullable/defaulted columns and non-breaking enum extension.

## Out of Scope (Intentional)

- Per-object checkpoint resume for folder rename/delete
- Hard cancellation of already in-flight S3 calls
- Production secret lifecycle automation for Garage (integration automation only)
- Full SIEM/dashboard product inside repo
