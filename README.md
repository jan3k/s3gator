# S3Gator

Production-oriented S3 Storage Manager for **Garage v2.2.0**, built with **Node.js + TypeScript**.

It provides a secure, server-backed file manager with local/LDAP login, RBAC + per-bucket permissions, multipart upload, preview/download flows, and admin/audit operations.

## Garage Compatibility Scope

S3Gator intentionally follows Garage realities:

- Garage Admin API **v2** with bearer token auth.
- S3 access via AWS SDK v3 against a configurable endpoint/region/path-style mode.
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
- Runtime auth mode enforcement: `local`, `ldap`, or `hybrid`.
- Cookie session auth with CSRF protection.
- Redis-backed distributed login throttling.
- Role model: `SUPER_ADMIN`, `ADMIN`, `USER`.
- Server-side user-management policy hardening:
  - only `SUPER_ADMIN` can assign/remove `SUPER_ADMIN`,
  - `ADMIN` can manage only `USER` accounts.
- Scoped admin v2:
  - optional `ADMIN` bucket scopes for grant and operational visibility actions,
  - `SUPER_ADMIN` remains global bypass.
- Per-bucket capability grants (e.g. `object:read`, `object:upload`, `folder:delete`, `search:run`).
- Bucket visibility requires explicit `bucket:list`.
- Bucket browsing, search, folder operations, rename/delete, stats.
- Upload center with multipart upload orchestration, retry, cancel, and persisted resume metadata.
- Background jobs (DB-persisted) for heavy operations:
  - folder rename,
  - folder delete,
  - Garage bucket sync,
  - stale multipart cleanup.
- Presigned URL-based preview/download.
- Operational endpoints:
  - `GET /health/live`
  - `GET /health/ready`
  - `GET /metrics` (Prometheus format)
- Admin panel:
  - users/roles,
  - bucket grants,
  - admin scopes,
  - LDAP config,
  - Garage connection management + health checks,
  - background jobs + upload session visibility,
  - audit logs.

## Security Highlights

- Garage credentials/admin token are backend-only.
- Secrets stored in DB are encrypted (AES-256-GCM) using `APP_ENCRYPTION_KEY`.
- Login endpoints are Redis-backed rate-limited for multi-instance deployments.
- API response shaping avoids encrypted ciphertext leakage for admin settings/connections.
- Structured logging and audit metadata redaction for sensitive fields.
- Audit trail for auth, privileged settings, grant changes, and destructive operations.

See [docs/security.md](docs/security.md) for full details.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker + Docker Compose (for local PostgreSQL + Redis)

## Quick Start

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

## Manual Commands

```bash
npx pnpm install
npx pnpm db:generate
npx pnpm db:migrate
npx pnpm db:seed
npx pnpm dev
npx pnpm dev:worker
```

## Test and Build

```bash
npx pnpm lint
npx pnpm typecheck
npx pnpm test
npx pnpm test:e2e
npx pnpm test:e2e:integration
npx pnpm build
```

## Integration Stack (Full Lane)

Bring up full local integration dependencies:

```bash
npx pnpm integration:up
```

This starts:
- PostgreSQL
- Redis
- Garage v2.2.0
- API
- Worker
- Web

Run full integration Playwright lane:

```bash
INTEGRATION_E2E=1 \
INTEGRATION_BUCKET_NAME=<existing-garage-bucket-alias> \
npx pnpm test:e2e:integration
```

Tear down:

```bash
npx pnpm integration:down
```

## Default Seed Account

Seed values are controlled by environment variables:

- `DEFAULT_SUPER_ADMIN_USERNAME`
- `DEFAULT_SUPER_ADMIN_PASSWORD`
- `DEFAULT_SUPER_ADMIN_EMAIL`

Default values are in `.env.example` and should be changed immediately.

## Docs

- [docs/discovery.md](docs/discovery.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/security.md](docs/security.md)
- [docs/stage3-plan.md](docs/stage3-plan.md)
- [docs/operations.md](docs/operations.md)

## Known Limitations

- Folder rename/delete are job-backed and restart-safe, but do not persist per-object checkpoints for mid-job resume.
- Cancel requests are best-effort for long S3 operations already in-flight.
- Full integration E2E lane assumes Garage is initialized with usable S3 credentials and at least one test bucket alias.
