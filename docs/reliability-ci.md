# Reliability CI Lane

Date: 2026-04-10

## Command

```bash
npx pnpm integration:reliability:ci
```

## What It Runs

1. reliability v2 baseline (`integration:reliability:v2`):
   - retry + restart + multi-worker contention + reclaim path
2. deterministic Stage 7 checks:
   - maintenance run-once contention does not double-enqueue
   - destructive folder-delete job remains non-retryable
   - destructive job emits exactly one terminal event

## Key Environment Knobs

- `INTEGRATION_RELIABILITY_CI_CONTENTION_CALLS`
- `INTEGRATION_RELIABILITY_CI_WAIT_FOR_TERMINAL_MS`
- plus existing v2 knobs (`INTEGRATION_RELIABILITY_V2_*`, `INTEGRATION_JOB_LOCK_TTL_SECONDS`)

## Intended Usage

- CI pipeline stage for distributed reliability regression checks
- pre-release validation in integration environment

## Boundaries

- This validates job-level reliability invariants, not per-object checkpoint resume.
