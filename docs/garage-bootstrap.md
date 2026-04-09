# Garage Bootstrap (Integration/CI)

Date: 2026-04-09

## Purpose

Stage 4 adds deterministic bootstrap automation for dev/integration/CI stacks so real upload/list/job flows run without manual Garage initialization.

## Script

Bootstrap entrypoint:

- `scripts/integration-bootstrap.mjs`

Convenience commands:

```bash
npx pnpm integration:up
npx pnpm integration:bootstrap
npx pnpm integration:test
```

## What Bootstrap Provisions

In integration environment, bootstrap ensures:

1. Garage Admin API v2 is reachable with configured token.
2. Garage cluster layout is initialized (idempotent).
3. Integration S3 key exists and secret matches configured value.
4. Integration bucket exists.
5. Integration alias exists (`INTEGRATION_BUCKET_NAME`).
6. Key has read/write/owner permissions on integration bucket.
7. App API is reachable and login works.
8. Connection health check succeeds in app.
9. Bucket sync job completes.
10. Bucket becomes visible via app admin bucket API.

## Idempotency Notes

- Re-running bootstrap is expected and safe for existing layout/key/bucket/alias.
- If a pre-existing key exists with different secret than configured, bootstrap fails loudly.

## Environment Variables

Key integration variables:

- `INTEGRATION_GARAGE_ADMIN_TOKEN`
- `INTEGRATION_GARAGE_ACCESS_KEY_ID`
- `INTEGRATION_GARAGE_SECRET_ACCESS_KEY`
- `INTEGRATION_GARAGE_BUCKET_NAME`
- `INTEGRATION_BUCKET_NAME`
- `INTEGRATION_ADMIN_USERNAME`
- `INTEGRATION_ADMIN_PASSWORD`

See `.env.example` for defaults.

## Security Scope

This bootstrap is intended for development and automated integration environments. Do not use these static defaults for production credential lifecycle.
