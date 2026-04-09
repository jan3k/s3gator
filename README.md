# S3Gator

Production-oriented S3 Storage Manager for **Garage v2.2.0**, built with **Node.js + TypeScript**.

It provides a secure, server-backed file manager with local/LDAP login, RBAC + per-bucket permissions, resumable multipart uploads, background jobs, and operator-grade audit/telemetry capabilities.

## Garage Compatibility Scope

S3Gator intentionally follows Garage realities:

- Garage Admin API **v2** with bearer token auth.
- S3 access via AWS SDK v3 against configurable endpoint/region/path-style mode.
- No ACL/policy-driven authorization in the app.
- No object versioning feature surface.

## Monorepo Layout

- `apps/api` -> NestJS backend API + Prisma + PostgreSQL
- `apps/web` -> Next.js frontend
- `packages/shared` -> roles, permissions, shared schemas/types
- `packages/s3` -> Garage-compatible S3/Admin service layer
- `packages/ui` -> shared UI primitives

## Key Features

- Local auth (Argon2id) and LDAP auth.
- Runtime auth mode enforcement: `local`, `ldap`, `hybrid`.
- Cookie session auth with CSRF protection.
- Redis-backed distributed login throttling.
- Role model: `SUPER_ADMIN`, `ADMIN`, `USER`.
- Scoped admin v2 with optional bucket scope constraints for `ADMIN` users.
- Per-bucket capability grants with explicit `bucket:list` visibility.
- Background jobs for heavy operations:
  - folder rename,
  - folder delete,
  - Garage bucket sync,
  - stale multipart cleanup,
  - operational retention cleanup.
- Policy-driven retries for retryable jobs (`BUCKET_SYNC`, `UPLOAD_CLEANUP`, `RETENTION_CLEANUP`) with bounded backoff.
- Non-retryable destructive jobs (`FOLDER_RENAME`, `FOLDER_DELETE`) to avoid unsafe duplicate destructive execution.
- Persistent job timeline events (`job_events`) with structured metadata.
- Job retry/reclaim visibility in API and admin UI (`attemptCount`, `maxAttempts`, `nextRetryAt`, retry exhaustion events).
- Operational data retention controls for `job_events`, `audit_logs`, terminal jobs, and terminal upload sessions.
- Resumable multipart upload sessions with persisted part state.
- Prometheus metrics + health endpoints.
- Correlation IDs + OpenTelemetry hooks for API and worker paths.
- Admin panel with:
  - users/roles,
  - bucket grants/scopes,
  - LDAP and auth mode settings,
  - connection health,
  - jobs timeline view,
  - upload session visibility,
  - audit logs.

## Security Highlights

- Garage credentials/admin tokens are backend-only.
- Secrets at rest are encrypted (AES-256-GCM via `APP_ENCRYPTION_KEY`).
- API responses never expose encrypted secret columns.
- Distributed login rate limiting via Redis.
- Redaction in logs and audit metadata for password/secret/token fields.
- Audit trail for auth/admin/destructive and job lifecycle events.

See [docs/security.md](docs/security.md) for details.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker + Docker Compose (for local/integration dependencies)

## Quick Start (Local Dev)

1. Prepare environment:

```bash
cp .env.example .env
```

2. Bootstrap local dependencies + DB + seed admin:

```bash
bash ./scripts/dev-bootstrap.sh
```

3. Start API, web, and worker:

```bash
npx pnpm dev
npx pnpm dev:worker
```

4. Open:

- Web: `http://localhost:3000`
- API Swagger: `http://localhost:4000/docs`
- API health: `http://localhost:4000/health/live`
- API metrics: `http://localhost:4000/metrics`

## Test and Build

```bash
npx pnpm lint
npx pnpm typecheck
npx pnpm test
npx pnpm test:e2e
npx pnpm build
```

## Full Integration Lane (Garage + Redis + DB + API + Worker + Web)

Start stack and run deterministic Garage/app bootstrap:

```bash
npx pnpm integration:up
```

Run full backend-integrated Playwright lane:

```bash
npx pnpm integration:test
```

Run worker restart/reclaim reliability validation lane:

```bash
npx pnpm integration:reliability
```

Re-run bootstrap only:

```bash
npx pnpm integration:bootstrap
```

Tear down integration stack:

```bash
npx pnpm integration:down
```

Run direct retention cleanup maintenance command:

```bash
npx pnpm maintenance:retention
```

## Default Seed Account

Seed values are controlled by environment variables:

- `DEFAULT_SUPER_ADMIN_USERNAME`
- `DEFAULT_SUPER_ADMIN_PASSWORD`
- `DEFAULT_SUPER_ADMIN_EMAIL`

Change defaults immediately outside local development.

## Docs

- [docs/discovery.md](docs/discovery.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/security.md](docs/security.md)
- [docs/operations.md](docs/operations.md)
- [docs/garage-bootstrap.md](docs/garage-bootstrap.md)
- [docs/integration-testing.md](docs/integration-testing.md)
- [docs/telemetry.md](docs/telemetry.md)
- [docs/data-retention.md](docs/data-retention.md)
- [docs/reliability.md](docs/reliability.md)
- [docs/slo-sli.md](docs/slo-sli.md)
- [docs/stage2-hardening-plan.md](docs/stage2-hardening-plan.md)
- [docs/stage3-plan.md](docs/stage3-plan.md)
- [docs/stage4-plan.md](docs/stage4-plan.md)
- [docs/stage5-plan.md](docs/stage5-plan.md)

## Known Limitations

- Folder rename/delete jobs are durable and restart-safe, but there is no per-object checkpoint resume inside a running rename/delete operation.
- Job cancel is best-effort and may wait for in-flight S3 calls to finish before stopping.
- Garage bootstrap automation is designed for dev/integration/CI environments and should not be used as-is for production secret lifecycle management.
- Retention currently uses hard-delete windows (no archive table tier in Stage 5).
