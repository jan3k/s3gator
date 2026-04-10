# Security Model

Date: 2026-04-10

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

## Audit, Jobs, and Archive Security

`audit_logs` + `job_events` persist security and operational trails.

Stage 6 archive mode copies hot records into:

- `AuditLogArchive`
- `JobEventArchive`

Stage 7 archive governance adds second-level lifecycle windows:

- `ARCHIVE_RETENTION_AUDIT_LOG_DAYS`
- `ARCHIVE_RETENTION_SECURITY_AUDIT_DAYS`
- `ARCHIVE_RETENTION_JOB_EVENT_DAYS`

Security-relevant archive audit records are retained longer than routine archive records by policy.

## Safe Archive Access Controls

Stage 7 adds read-only archive browse APIs/UI with strict constraints:

- archive API is `SUPER_ADMIN` only,
- deterministic pagination/sorting,
- bounded safe search fields,
- no secret material exposure,
- existing redaction guarantees preserved.

Endpoints:

- `GET /admin/audit/archive`
- `GET /jobs/archive/events`

## Scheduler and Maintenance Security

Scheduler remains in-process and Redis-lock coordinated.

Stage 7 hardening:

- per-task enable flags,
- lock TTL safety guard,
- explicit scheduled/manual trigger metadata,
- safe manual run-once API (`POST /jobs/maintenance/tasks/:task/run-once`) restricted to `SUPER_ADMIN`.

Duplicate active maintenance jobs are prevented by active-job checks + lock coordination.

## Correlation IDs and Telemetry Security

- API assigns/propagates request correlation IDs (`x-request-id` by default).
- Correlation IDs are included in logs, jobs, timeline events, and audit context metadata.
- OTEL export is opt-in and does not include plaintext secrets by design.

## Integration/CI Security Posture

- Integration bootstrap provisions deterministic dev/test credentials and bucket aliases only for non-production usage.
- Reliability CI lane intentionally exercises failure/restart scenarios and should run on isolated non-production environments.
- Production secret lifecycle and credential rotation remain operator responsibilities outside bootstrap scripts.

## Known Security Boundaries

- Fine-grained object-level ABAC beyond bucket capabilities is not implemented.
- Job cancellation is best-effort when underlying S3 calls are already in-flight.
- Archive tier is an operational archive in the same database, not immutable compliance cold storage.
