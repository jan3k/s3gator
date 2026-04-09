# Stage 2 Hardening Plan

Date: 2026-04-09

## Scope

Focused hardening/refinement pass on existing `jan3k/s3gator` codebase. No framework or architecture replacement.

## Issues Found and Chosen Resolution

## 1) Admin privilege escalation risk in user management

### Current issue
- `PATCH /admin/users/:id` is available to both `SUPER_ADMIN` and `ADMIN`.
- Service-level update logic has no actor-aware policy checks.
- `ADMIN` can currently change roles (including to `SUPER_ADMIN`), deactivate privileged users, or reset passwords for privileged users.

### Resolution
- Implement explicit actor-aware policy checks in `UsersService` and enforce from controller:
  - only `SUPER_ADMIN` can assign/remove `SUPER_ADMIN` role,
  - `ADMIN` may only manage `USER` accounts,
  - `ADMIN` cannot modify `ADMIN`/`SUPER_ADMIN` targets,
  - `ADMIN` cannot change own role,
  - no actor can deactivate own account through admin flow.
- Keep creation endpoint `SUPER_ADMIN` only.
- Add tests for escalation attempts and allowed super-admin operations.

## 2) Audit logging coverage mismatch vs docs

### Current issue
- Audit logs exist but only cover a subset of events.
- Key security/admin actions are not logged.

### Resolution
- Add audit events for:
  - login success/failure (local + LDAP distinction),
  - logout,
  - user create/update (including role/status/password changes),
  - bucket grant changes,
  - LDAP settings changes,
  - auth mode changes,
  - connection create/update/health check,
  - bucket sync from Garage Admin API.
- Keep existing file/folder destructive and multipart complete/abort logs.
- Add redaction in audit metadata to block secret/password/token leakage.
- Add tests asserting required audit calls.

## 3) Dead/partial `auth_mode`

### Current issue
- `auth_mode` exists in settings but login flow does not enforce it clearly.

### Resolution (Option A)
- Fully wire `auth_mode` into runtime auth:
  - `local`: local auth only,
  - `ldap`: LDAP auth only,
  - `hybrid`: explicit mode honored; default is local then LDAP fallback when LDAP enabled.
- Expose public read endpoint for effective mode to support login UX.
- Update login UI to respect configured mode.
- Add tests for `auth_mode` behavior.

## 4) `bucket:list` semantics ambiguity

### Current issue
- `bucket:list` exists but non-super bucket visibility currently works with any grant.

### Resolution (Model A)
- Bucket visibility requires explicit `bucket:list` grant.
- Keep permission code in schema/model.
- Update authorization service visibility query and bucket permission logic to remove implicit any-grant behavior for `bucket:list`.
- Keep docs and seed behavior consistent with explicit visibility semantics.
- Add tests for visibility filtering.

## 5) Sensitive ciphertext leakage in connection responses

### Current issue
- connection create/update endpoints return raw DB rows, including encrypted secret fields.

### Resolution
- Introduce explicit public DTO shaping in connections service/controller.
- Ensure no response returns encrypted secret columns.
- Extend tests to assert absence of encrypted fields.

## 6) Multipart upload contract/UX robustness gaps

### Current issue
- UI uploads parts sequentially, no retry, weak cancel behavior, limited failure handling.

### Resolution
- Add client-side multipart upload helper with:
  - bounded part concurrency,
  - per-part retry with backoff,
  - accurate aggregate progress,
  - abort/cancel support.
- On client cancel/failure, call server abort/fail endpoint and update server-side status.
- Add backend endpoint to mark failed upload session state cleanly.
- Add unit tests for retry helper and backend multipart lifecycle methods.

## 7) Rename/delete resumability overclaim

### Current issue
- docs imply stronger resumable checkpoint guarantees than current implementation.

### Resolution
- Keep bounded-concurrency copy+delete implementation.
- Do not add heavy queue system in Stage 2.
- Update docs to accurately describe current behavior and limitations.

## 8) Missing lint quality gates

### Current issue
- lint scripts are placeholders.

### Resolution
- Add real ESLint config (flat config) for TS/TSX code in monorepo.
- Replace placeholder lint scripts with real commands.
- Make root `pnpm lint` enforce checks.

## 9) Test depth gaps

### Current issue
- tests are shallow and do not verify hardening controls.

### Resolution
- Add focused unit/service tests for:
  - privilege escalation prevention,
  - allowed super-admin role changes,
  - auth mode enforcement,
  - bucket visibility model,
  - connection response redaction,
  - audit logging for critical events,
  - multipart lifecycle and retry helper.
- Expand Playwright with authenticated flow (login -> files page).

## Behavior Changes

- `bucket:list` is now required for bucket visibility.
- `auth_mode` is enforced at login (not just configuration metadata).
- `ADMIN` user-management privileges are restricted to prevent escalation.
- Connection endpoints now return only sanitized DTOs.
- Multipart UI now supports retry + cancel with clearer failure states.

## Testing Strategy

1. Unit/service tests (Vitest, API):
- user management policy matrix,
- auth mode matrix,
- bucket visibility filtering,
- connections DTO redaction,
- audit logging calls.

2. Multipart tests:
- API files service multipart init/sign/complete/abort/fail status paths,
- web multipart retry helper logic (retry + abort).

3. E2E (Playwright):
- login flow with authenticated redirect/landing verification.

4. Quality gates:
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build` all passing.
