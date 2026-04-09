# Reliability Validation (Stage 5)

Date: 2026-04-09

## Goal

Validate that worker interruption/restart does not silently lose long-running jobs and that reclaim behavior is visible.

## What Is Validated

`integration:reliability` validates:

1. long-running folder rename job is queued,
2. job reaches `RUNNING`,
3. worker process/container is interrupted,
4. stale lock window expires,
5. worker restarts and reclaims stale running job,
6. timeline contains reclaim signal,
7. job reaches one terminal state (no duplicate terminal completion).

## Command

```bash
npx pnpm integration:reliability
```

Prerequisite: integration stack should be running (`integration:up`) or reachable.

## Key Environment Variables

- `INTEGRATION_WORKER_CONTAINER` (default: `s3gator-int-worker`)
- `INTEGRATION_JOB_LOCK_TTL_SECONDS` (default: `20` in integration compose)
- `INTEGRATION_RELIABILITY_FILE_COUNT` (default: `120`)
- `INTEGRATION_RELIABILITY_WAIT_FOR_RUNNING_MS`
- `INTEGRATION_RELIABILITY_WAIT_FOR_TERMINAL_MS`

## Boundaries

- This validates job-level reclaim/resume behavior, not per-object checkpoint resume.
- Cancellation remains best-effort for in-flight S3 operations.
- Reliability lane is heavier than fast test lane and should be used in CI/nightly or pre-release checks.
