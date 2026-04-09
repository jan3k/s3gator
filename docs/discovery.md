# Discovery: Workspace and Garage v2.2.0 Reality Check

Date: 2026-04-09

## Scope Reviewed

- Local operational config files:
  - `s3-own-config/garage01.txt`
  - `s3-own-config/garage02.txt`
  - `s3-own-config/garage03.txt`
  - `s3-own-config/S3-credentials`
- Local Garage source/docs snapshot:
  - `garage/Cargo.toml`
  - `garage/doc/book/reference-manual/admin-api.md`
  - `garage/doc/book/reference-manual/s3-compatibility.md`
  - `garage/doc/book/reference-manual/configuration.md`
  - `garage/doc/api/garage-admin-v2.json`
  - `garage/doc/book/quick-start/_index.md`

## Confirmed Garage Version

- Workspace snapshot is Garage `v2.2.0` (confirmed in `garage/Cargo.toml` workspace crate versions and Admin OpenAPI `info.version`).

## Discovered Deployment Assumptions (from `s3-own-config`)

### Cluster Topology

- 3 Garage nodes:
  - `10.5.0.1` (`garage01`)
  - `10.5.0.2` (`garage02`)
  - `10.5.0.3` (`garage03`)
- `replication_factor = 3`.
- Internal bind ports per node:
  - S3 API: `3900`
  - RPC: `3901`
  - S3 Web: `3902`
  - Admin API: `3903`
- Region: `s3_region = "garage"`.

### Public/Edge Access Pattern

- Reverse-proxy/LB pattern with host split:
  - API host: `s3.cassocash.cz`
  - Public content host: `cdn.cassocash.cz`
- `s3_web.root_domain = ".cassocash.cz"` observed.
- Internal/private network gating is present for API in HAProxy ACLs (indicates admin/API endpoints are not intended to be globally open).

### Credential Handling Reality in Repo

- `s3-own-config/S3-credentials` contains a static access key + secret key in plaintext.
- Config snapshots include private tokens/secrets (`rpc_secret` etc.) in plaintext.

Security implication: current workspace contains sensitive material that must not be exposed via frontend, logs, screenshots, or default docs output.

## Garage v2.2.0 Behavior Constraints Relevant to App Design

## 1) Authorization model is not ACL/policy-centric

From S3 compatibility docs:
- ACL endpoints: missing.
- Bucket policy endpoints: missing.
- Garage uses key-to-bucket permission model.

Decision:
- App authorization must be app-native (DB-backed RBAC/ABAC), independent of S3 ACL/policy semantics.

## 2) Versioning is unsupported

From S3 compatibility docs:
- Bucket versioning: missing/stub behavior.

Decision:
- No object versioning UI/workflows in the application.

## 3) URL style compatibility

From config docs:
- Path-style is always enabled.
- Vhost-style is optional via `s3_api.root_domain`.

Decision:
- Backend S3 client must support both:
  - `forcePathStyle = true` (default-safe for Garage + reverse-proxy setups)
  - optional vhost style for environments that require it.

## 4) Admin API shape and auth

From Admin API docs + `garage-admin-v2.json`:
- Admin API current version is `v2`.
- Token auth is `Authorization: Bearer <token>`.
- Relevant endpoints available: `/v2/ListBuckets`, `/v2/GetBucketInfo`, `/v2/ListKeys`, `/v2/GetClusterHealth`, etc.

Decision:
- Implement a typed Garage Admin v2 HTTP client in backend.
- No reliance on old v0/v1 SDK examples.

## 5) Multipart and presign support

From S3 compatibility docs:
- Multipart endpoints implemented.
- Presigned URLs implemented.

Decision:
- Upload architecture will support server-orchestrated multipart uploads + presigned part URLs.

## Endpoint/Region Conventions to Encode as Defaults

- Region default: `garage`.
- Admin API base URL default should target internal/private endpoint, not public CDN.
- S3 endpoint default should be environment-configurable; likely one of:
  - internal node/service endpoint (preferred for backend)
  - public `s3.cassocash.cz` where appropriate.
- Force path-style default: `true` for Garage reliability behind LBs/proxies.

## Open Risks and Unknowns

1. The checked-in config files are snapshots; current production values may differ.
2. Existing plaintext credentials in workspace are high-risk; no automated import will be implemented.
3. Whether backend can directly reach private `10.5.0.x` addresses depends on deployment network.
4. LDAP infra details (TLS, CA trust, group attributes, search filter shape) are not in workspace and must remain configurable.
5. Admin token scope hardening is not documented in workspace deployment; app should support least-privilege token usage.

## Resulting Guardrails for Implementation

- Keep all Garage secrets/admin tokens server-side only.
- Build authN/authZ in app database (users, sessions, per-bucket permission assignments).
- Exclude unsupported Garage features (ACL/policy/versioning UIs).
- Treat Garage credentials as infrastructure credentials, never user identity credentials.
- Make all Garage connection settings explicit and environment-driven.
