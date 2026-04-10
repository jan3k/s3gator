# Archive Access

Date: 2026-04-10

## Role Scope

Archive browsing is read-only and limited to `SUPER_ADMIN`.

## Endpoints

- `GET /admin/audit/archive`
- `GET /jobs/archive/events`

## Common Query Controls

- pagination: `limit`, `offset`
- deterministic order: `createdAt desc`, `id desc`
- date range: `from`, `to`
- correlation filtering: `correlationId`

## Audit Archive Filters

- `action`
- `entityType`
- `search` (safe bounded fields)

## Job Event Archive Filters

- `jobId`
- `type`
- `level`
- `search` (safe bounded fields)

## UI

Admin page includes an "Archive browser" with separate views for archived audit logs and archived job events.
