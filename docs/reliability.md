# Reliability Validation

Date: 2026-04-10

## Reliability Lanes

### `integration:reliability`

Validates restart/reclaim baseline:

1. queue long-running rename job
2. interrupt worker during `RUNNING`
3. wait lock expiry
4. restart worker
5. verify reclaim signal + single terminal event

### `integration:reliability:v2`

Extends baseline with retry + contention:

1. force retryable `BUCKET_SYNC` failures
2. restart during retry lifecycle
3. use secondary worker contention path
4. verify coherent retry timeline + no duplicate terminal event

### `integration:reliability:ci`

Stage 7 deterministic CI lane:

1. runs v2 baseline
2. validates duplicate-safe maintenance run-once contention
3. validates destructive job remains non-retryable (`retryable=false`, `maxAttempts=1`)
4. validates single terminal event invariant for destructive job

## Commands

```bash
npx pnpm integration:reliability
npx pnpm integration:reliability:v2
npx pnpm integration:reliability:ci
```

## Key Environment Variables

- `INTEGRATION_WORKER_CONTAINER`
- `INTEGRATION_SECONDARY_WORKER_CONTAINER`
- `INTEGRATION_JOB_LOCK_TTL_SECONDS`
- `INTEGRATION_RELIABILITY_V2_WAIT_FOR_RETRY_MS`
- `INTEGRATION_RELIABILITY_V2_WAIT_FOR_COMPLETION_MS`
- `INTEGRATION_RELIABILITY_CI_CONTENTION_CALLS`
- `INTEGRATION_RELIABILITY_CI_WAIT_FOR_TERMINAL_MS`

## Boundaries

- Reliability coverage is job-level and does not provide per-object checkpoint resume.
- Cancellation remains best-effort for in-flight S3 operations.
