# Security Model

Date: 2026-04-09

## Core Guarantees

- Garage access credentials and Admin API bearer tokens remain backend-only.
- Browser clients never receive raw Garage secrets/admin tokens.
- Authorization decisions are app-native (RBAC + per-bucket grants), not Garage ACL/policy based.
- Session auth uses `HttpOnly` cookies with CSRF protection.
- Sensitive values are encrypted at rest and redacted in logs/audit metadata.

## Authentication and Session Controls

- Local auth with Argon2id password hashing.
- LDAP auth via `ldapts` with configurable bind/search and group-role mapping.
- Runtime auth mode enforcement (`local`, `ldap`, `hybrid`) in backend auth flow.
- Session records persisted in DB; tokens are hashed before storage.
- Logout revokes current session.
- Distributed login throttling via Redis for multi-instance correctness.

## Authorization Controls

- Roles: `SUPER_ADMIN`, `ADMIN`, `USER`.
- Per-bucket permissions include explicit `bucket:list` visibility.
- Stage 2 anti-escalation constraints preserved:
  - only `SUPER_ADMIN` can assign/remove `SUPER_ADMIN`,
  - `ADMIN` can manage only `USER` accounts,
  - `ADMIN` cannot modify `ADMIN`/`SUPER_ADMIN` targets.
- Scoped admin v2:
  - `ADMIN` operations can be constrained to scoped buckets,
  - `SUPER_ADMIN` remains global bypass.

## Secrets and Data Handling

- DB-stored secrets (Garage keys/tokens, LDAP bind password) are encrypted via AES-256-GCM with `APP_ENCRYPTION_KEY`.
- API response DTOs omit secret ciphertext columns.
- Redaction applies to password/token/secret-like keys recursively for logs and audit metadata.

## Audit and Job Event Trail

`audit_logs` records security/operational events, including:

- auth success/failures and logout,
- user/role/status/password admin operations,
- LDAP/auth-mode/config changes,
- bucket grant/scope changes,
- connection changes/health checks,
- destructive object/folder operations,
- multipart completion/abort/fail,
- bucket sync actions.

Stage 4 also adds `job_events` timeline persistence for operator diagnostics:

- lifecycle events (`created`, `claimed`, `started`, `progress`, `failed`, `completed`, `canceled*`),
- domain-step events with structured metadata,
- correlation IDs for cross-runtime traceability.

Stage 5 adds:

- explicit retry/reclaim timeline events (`retry_*`, `reclaimed`),
- retained/cleanup operational lifecycle controls for `job_events` and `audit_logs`,
- longer retention window for security-relevant audit actions vs general audit noise.

## Correlation IDs and Telemetry Security

- API assigns/propagates request correlation IDs (`x-request-id` by default).
- Correlation IDs are included in logs, jobs, and timeline events.
- OTEL export is opt-in via env and does not include plaintext secret fields by design.

## Integration/CI Security Posture

- Stage 4 integration bootstrap provisions deterministic dev/test credentials and bucket aliases.
- These integration defaults are for non-production environments only.
- Production should use separate credentials, stronger secret lifecycle management, and restricted network access.

## Known Security Limitations

- Fine-grained object-level ABAC beyond bucket capabilities is not implemented.
- Job cancellation is best-effort when underlying S3 calls are already in-flight.
- Full SIEM export pipeline is out of scope by default (logs/metrics/traces hooks are available).
- Retention currently uses hard-delete windows (no archival table tier), so operators should export logs/events externally when longer-term retention is required.
