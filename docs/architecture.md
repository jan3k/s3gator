# Architecture: S3 Storage Manager for Garage v2.2.0

Date: 2026-04-09

## Goals

- Production-grade, secure, server-backed Garage S3 manager.
- Human users authenticated in app (local or LDAP).
- Authorization enforced by app DB policy layer (RBAC + per-bucket capabilities).
- Garage credentials treated as infrastructure secrets.
- No dependency on unsupported Garage features (ACL/policy/versioning).

## Monorepo Layout

- `apps/api` -> NestJS backend API (TypeScript)
- `apps/web` -> Next.js frontend (React/TypeScript)
- `packages/shared` -> shared domain types, Zod schemas, permission constants
- `packages/s3` -> Garage-compatible S3 + Admin API clients and file-operation services
- `packages/ui` -> reusable UI primitives/components for web app

Tooling:
- `pnpm` workspaces
- TypeScript project references
- ESLint + Prettier
- Vitest (unit/integration), Playwright (critical E2E)

## Security Architecture

### Trust Boundaries

- Browser is untrusted.
- API is policy decision + enforcement point.
- Garage S3/Admin credentials are server-side only.

### Session/Auth

- Cookie-based sessions (`HttpOnly`, `SameSite=Lax`, secure in prod).
- Session records persisted in PostgreSQL (`sessions` table).
- CSRF token validation for mutating cookie-authenticated requests.
- Login rate limiting per IP + username.
- Password hashing: Argon2id.

### Secrets

- Secrets loaded from env / encrypted DB fields for runtime-managed connection records.
- No secret returned in API responses.
- Audit log excludes secret values.

### Auditing

- Append-only audit table for:
  - auth events,
  - admin config changes,
  - destructive object operations,
  - permission changes.

## Authentication Model

Two runtime modes (configurable):

1. Local auth
- Username/email + password (Argon2id).
- Supports bootstrap Super Admin seed user.

2. LDAP auth
- Configurable server URL, bind DN/password, search base, search filter.
- Optional group -> role mapping.
- Optional fallback local Super Admin account for break-glass.

Implementation detail:
- Unified `AuthService` dispatches to local/LDAP provider by mode.
- On LDAP login success, user profile is upserted in local DB for authorization and audit continuity.

## Authorization Model

### Base roles

- `SUPER_ADMIN`
- `ADMIN`
- `USER`

### Per-bucket capabilities (DB-managed)

- `bucket:list`
- `object:list`
- `object:read`
- `object:preview`
- `object:download`
- `object:upload`
- `object:delete`
- `object:rename`
- `folder:create`
- `folder:rename`
- `folder:delete`
- `folder:stats`
- `search:run`

### Evaluation

- Super Admin bypasses bucket scope checks.
- Others require explicit assignment (`user_bucket_permissions`).
- Bucket visibility is explicit and requires `bucket:list`.
- API guards + policy service enforce capability checks before any S3/Admin operation.
- User-management policy is enforced server-side:
  - only `SUPER_ADMIN` can assign/remove `SUPER_ADMIN`,
  - `ADMIN` can manage only `USER` accounts,
  - `ADMIN` cannot modify privileged targets.

## Backend Service Design

## 1) `packages/s3`: Garage Integration Layer

### S3 client factory

- AWS SDK v3 `S3Client` with explicit:
  - endpoint
  - region
  - `forcePathStyle`
  - credentials
- Optional per-request abort signal support.

### Admin API v2 client

- Typed HTTP client (OpenAPI-derived request/response contracts as internal TS types).
- Bearer token auth only.
- Methods for health checks, buckets, keys metadata.

### File operation service contract

Provided operations:
- `listFiles(s3, prefix, bucket, opts?)`
- `addFolder(s3, folderPath, bucket)`
- `deleteFileOrFolder(s3, key, bucket)`
- `renameFileOrFolder(s3, oldKey, newKey, bucket)`
- `renameFolder(s3, oldPrefix, newPrefix, bucket)`
- `getFilePreview(s3, key, download, bucket)`
- `getFolderStats(s3, prefix, bucket)`
- `searchFilesAndFolders(s3, prefix, term, bucket)`
- `multiPartUpload(...)` orchestration primitives

Semantics:
- Virtual folders represented by key prefixes.
- Empty folder create via zero-byte `<prefix>/` placeholder object.
- Rename implemented as copy+delete with bounded concurrency and in-request progress reporting.
- Folder delete = recursive list + batch delete.
- Search = recursive paginated listing under prefix + in-memory/key matching (contains/case-insensitive).

## 2) `apps/api`: NestJS API

Main modules:
- `AuthModule` (local/LDAP, sessions, CSRF)
- `UsersModule` (CRUD + role mgmt)
- `AuthorizationModule` (guards + policy evaluator)
- `BucketsModule` (bucket metadata + grants)
- `FilesModule` (browse/upload/rename/delete/search/stats/preview)
- `ConnectionsModule` (Garage connection config + health)
- `AuditModule` (query + append logs)
- `SettingsModule` (LDAP mode, app settings)

Cross-cutting:
- request validation (Zod-based DTO parsing)
- structured logging
- OpenAPI/Swagger
- global exception mapping

## Upload Architecture

### Strategy

- Browser requests upload session from API.
- API validates permissions and target path.
- API creates multipart upload and returns signed URLs per part.
- Browser uploads parts directly to Garage S3-compatible endpoint.
- Browser reports completed ETags.
- API completes multipart upload.

### Features

- large file support
- retry per part
- cancel/abort upload
- progress reporting
- folder drag/drop relative path preservation
- upload session state persistence (`INITIATED`/`IN_PROGRESS`/`COMPLETED`/`ABORTED`/`FAILED`)

## Frontend Architecture (`apps/web`)

### Stack

- Next.js + React + TypeScript
- Tailwind + shadcn/ui
- TanStack Query
- React Hook Form + Zod

### Feature areas

- Auth: login screen (local/LDAP aware)
- File manager:
  - bucket switcher
  - breadcrumbs
  - file/folder table
  - search + sorting
  - context actions
  - preview drawer
  - upload center
- Admin:
  - users/roles
  - bucket grants
  - LDAP config
  - Garage connection status
  - audit logs

### UX policy

- role-aware actions hidden/disabled by capability
- explicit loading/progress/error states
- keyboard-friendly dialogs/menus where practical

## Data Model Summary

Core tables:
- `users`
- `local_credentials`
- `ldap_config`
- `sessions`
- `roles`
- `permissions`
- `buckets`
- `user_bucket_permissions`
- `app_settings`
- `audit_logs`
- `upload_sessions`
- `garage_connections`

## Key Trade-offs

1. App-native RBAC over Garage key ACL-like grants
- Pros: strong human-user security model, auditable, independent of Garage key model.
- Cons: requires ongoing sync/discovery of buckets and careful backend enforcement.

2. Presigned multipart uploads vs backend proxy streaming
- Pros: scales better for large files; lower API bandwidth pressure.
- Cons: more orchestration complexity and upload session state.

3. Dual auth providers (local + LDAP)
- Pros: flexible enterprise deployment.
- Cons: more config validation and operational complexity.

4. No heavy background queue for rename/delete in Stage 2
- Pros: lower operational complexity and easier local deployment.
- Cons: long-running rename/delete operations do not provide persisted checkpoint/resume jobs.

## Non-Goals (by design)

- S3 ACL/policy management UI.
- Object versioning UI/workflows.
- Garage K2V management.

## Deployment Model (Local Dev)

- `docker-compose.dev.yml`:
  - Postgres
  - optional local Garage v2.2.0 container for integration tests
- API and web run via pnpm workspace scripts.
- Seed script creates first Super Admin and baseline roles/permissions.
