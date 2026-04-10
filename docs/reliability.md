# Reliability Validation (Stage 6)

Date: 2026-04-10

## Goal

Validate restart/reclaim correctness and retry lifecycle behavior under multi-worker contention.

## What Is Validated

`integration:reliability` (baseline) validates:

1. long-running folder rename job is queued,
2. job reaches `RUNNING`,
3. worker process/container is interrupted,
4. stale lock window expires,
5. worker restarts and reclaims stale running job,
6. timeline contains reclaim signal,
7. job reaches one terminal state (no duplicate terminal completion).

`integration:reliability:v2` validates:

1. retryable `BUCKET_SYNC` fails and is rescheduled,
2. worker restart occurs during retry lifecycle,
3. secondary worker contention path is exercised,
4. retry timeline remains coherent (`retry_scheduled`, `retry_started`, optional `retry_exhausted`),
5. no duplicate terminal event is emitted.

## Command

```bash
npx pnpm integration:reliability
npx pnpm integration:reliability:v2
```

Prerequisite: integration stack should be running (`integration:up`) or reachable.

## Key Environment Variables

- `INTEGRATION_WORKER_CONTAINER` (default: `s3gator-int-worker`)
- `INTEGRATION_JOB_LOCK_TTL_SECONDS` (default: `20` in integration compose)
- `INTEGRATION_RELIABILITY_FILE_COUNT` (default: `300`)
- `INTEGRATION_RELIABILITY_WAIT_FOR_RUNNING_MS`
- `INTEGRATION_RELIABILITY_WAIT_FOR_TERMINAL_MS`
- `INTEGRATION_RELIABILITY_V2_WAIT_FOR_RETRY_MS`
- `INTEGRATION_RELIABILITY_V2_WAIT_FOR_COMPLETION_MS`
- `INTEGRATION_SECONDARY_WORKER_CONTAINER` (default: `s3gator-int-worker-2`)

## Boundaries

- This validates job-level reclaim/retry behavior, not per-object checkpoint resume.
- Cancellation remains best-effort for in-flight S3 operations.
- Reliability lane is heavier than fast test lane and should be used in CI/nightly or pre-release checks.
