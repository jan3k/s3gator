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
- Role model: `SUPER_ADMIN`, `ADMIN`, `USER`.
- Server-side user-management policy hardening:
  - only `SUPER_ADMIN` can assign/remove `SUPER_ADMIN`,
  - `ADMIN` can manage only `USER` accounts.
- Per-bucket capability grants (e.g. `object:read`, `object:upload`, `folder:delete`, `search:run`).
- Bucket visibility requires explicit `bucket:list`.
- Bucket browsing, search, folder operations, rename/delete, stats.
- Upload center with multipart upload orchestration, retry, and cancel.
- Presigned URL-based preview/download.
- Admin panel:
  - users/roles,
  - bucket grants,
  - LDAP config,
  - Garage connection management + health checks,
  - audit logs.

## Security Highlights

- Garage credentials/admin token are backend-only.
- Secrets stored in DB are encrypted (AES-256-GCM) using `APP_ENCRYPTION_KEY`.
- Login endpoints are rate-limited.
- API response shaping avoids encrypted ciphertext leakage for admin settings/connections.
- Structured logging and audit metadata redaction for sensitive fields.
- Audit trail for auth, privileged settings, grant changes, and destructive operations.

See [docs/security.md](docs/security.md) for full details.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker + Docker Compose (for local PostgreSQL)

## Quick Start

1. Prepare environment:

```bash
cp .env.example .env
```

2. Bootstrap local dependencies + DB + seed admin:

```bash
bash ./scripts/dev-bootstrap.sh
```

3. Start API and web apps:

```bash
npx pnpm dev
```

4. Open:

- Web: `http://localhost:3000`
- API Swagger: `http://localhost:4000/docs`

## Manual Commands

```bash
npx pnpm install
npx pnpm db:generate
npx pnpm db:migrate
npx pnpm db:seed
npx pnpm dev
```

## Test and Build

```bash
npx pnpm typecheck
npx pnpm test
npx pnpm build
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

## Known Limitations

- Distributed rate limiting (e.g. Redis-backed) is not implemented yet.
- Folder rename/delete are bounded-concurrency operations without persisted checkpoint/resume jobs.
- Web E2E coverage includes authenticated flow baseline but is not a full regression suite.
- Local dev compose includes PostgreSQL only; Garage is expected from your existing environment or a separate deployment.
