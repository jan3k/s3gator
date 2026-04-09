# Security Model

Date: 2026-04-09

## Core Security Guarantees

- Garage access credentials and Admin API bearer tokens are stored server-side only.
- Browser clients never receive raw Garage secret keys or Admin API tokens.
- All user authorization decisions are enforced by backend policy checks, not by S3 ACLs/bucket policies.
- Object operations are permission-gated per bucket capability.
- Session cookies are `HttpOnly` and CSRF-protected for mutating requests.

## Threat Model Summary

### In scope

- Unauthorized end-user attempts against bucket/object operations.
- Credential leakage through frontend, logs, API payloads, or accidental config exposure.
- Session theft/replay risks for cookie-based auth.
- Brute-force login attempts.
- Privilege escalation through role or bucket grant misconfiguration.

### Out of scope

- Host/kernel compromise.
- Full network MITM when TLS is disabled by deployment.
- Compromise of external IdP/LDAP infrastructure itself.

## Implemented Controls

## 1) Authentication

- Local auth with Argon2id password hashing (`argon2`).
- LDAP auth via configurable LDAP server (`ldapts`), including:
  - bind DN + bind credential,
  - search base/filter,
  - optional group-to-role mapping.
- Session persistence in DB with token hashing and expiry.
- Rate limiting on login attempts (IP/username keyed window).

## 2) Session + CSRF

- Session token cookie is `HttpOnly` and `SameSite=Lax`.
- CSRF token is generated server-side and required on non-GET/HEAD/OPTIONS requests.
- Session revocation on logout.

## 3) Authorization

- Role layer: `SUPER_ADMIN`, `ADMIN`, `USER`.
- Fine-grained per-bucket capabilities:
  - `bucket:list`, `object:list`, `object:read`, `object:preview`, `object:download`,
  - `object:upload`, `object:delete`, `object:rename`,
  - `folder:create`, `folder:rename`, `folder:delete`, `folder:stats`,
  - `search:run`.
- Enforcement happens in backend guards/services before any Garage operation.

## 4) Secrets Handling

- Secrets in DB (Garage key/secret/admin token, LDAP bind password) are encrypted using AES-256-GCM with an app-level key (`APP_ENCRYPTION_KEY`).
- API responses never include decrypted secret values.
- Logging middleware redacts password/credential fields.

## 5) Audit Logging

- Security-relevant actions are written to `audit_logs`, including:
  - auth events,
  - admin settings changes,
  - bucket grant updates,
  - destructive object/folder operations,
  - multipart upload completion/abort.

## 6) Garage Compatibility Safety

- No implementation of unsupported Garage ACL/policy/versioning behavior.
- Garage Admin API v2 bearer token flows are used for admin operations.
- S3 client configuration keeps path-style compatibility by default.

## Deployment Recommendations

- Run API and web behind TLS (reverse proxy or ingress).
- Set `NODE_ENV=production` and secure cookie transport in production.
- Rotate `APP_ENCRYPTION_KEY`, Garage credentials, and LDAP bind secret regularly.
- Restrict DB/API network access to trusted ranges.
- Use dedicated low-privilege Garage credentials for app data plane where possible.
- Keep a fallback local Super Admin account for LDAP outage scenarios.

## Known Security Limitations

- Login rate limiter is currently in-memory per API process; for multi-instance deployments, move to Redis or DB-backed distributed rate limiting.
- Per-operation object-level ABAC beyond bucket capability is not yet implemented.
- Full SIEM export pipeline for audit logs is not included by default.
