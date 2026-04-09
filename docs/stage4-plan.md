# Stage 4 Plan: Garage Bootstrap Automation, Job Timeline, and End-to-End Telemetry

Date: 2026-04-09

## Scope

Stage 4 extends the existing Stage 3 architecture in-place (NestJS + Next.js + Prisma + pnpm workspaces). It focuses on operational repeatability, diagnosability, and telemetry.

## Stage 3 Limitations Addressed

1. Integration Garage bootstrap was manual/environment-specific.
2. Jobs had snapshot state but no durable event timeline.
3. Metrics existed, but request/job correlation and OpenTelemetry traces were missing.
4. Full integration lane required extra caveats and was not fully self-provisioning.
5. Job cancel semantics were best-effort but not sufficiently observable for operators.

## 1) Garage Bootstrap Design

Decision:
- Add deterministic integration bootstrap script under `scripts/`.
- Use Garage CLI in the running integration container for cluster layout + key + bucket provisioning.
- Use fixed integration key-id/secret defaults with valid Garage key format (`GK...`) and allow env overrides.
- Keep bootstrap idempotent by checking existing resources before create/import.

Provisioning outcome:
- single-node layout initialized if missing,
- one integration access key pair for app data-plane,
- one integration bucket + stable alias,
- bucket permissions granted to integration key.

Application-side verification:
- login through API with seeded super-admin,
- run connection health check through app API,
- enqueue + wait for bucket sync job completion,
- verify synced bucket visibility in app API.

## 2) Job Event Timeline Model

Decision:
- Add `JobEvent` persistence model linked to `Job`.
- Keep latest snapshot progress in `Job.progress`, but also append meaningful event records.
- Add event endpoints and job-detail endpoint with timeline payload.

Event categories:
- lifecycle: created, claimed, started, completed, failed, canceled_requested, canceled
- progress: progress_update (throttled)
- steps: domain-specific events for bucket sync/folder rename/folder delete/upload cleanup
- cancellation checkpoints: explicit best-effort cancel observations

Redaction discipline:
- event metadata is structured JSON and sanitized via existing audit/job metadata discipline,
- no secrets/tokens/passwords in event payload.

## 3) Telemetry + Correlation Design

Decision:
- Add request correlation ID middleware (`x-request-id`) for API.
- Store correlation ID in request context (AsyncLocalStorage) and propagate into logs/audit/job metadata.
- Persist correlation ID on job and event records for API->queue->worker traceability.
- Integrate OpenTelemetry SDK with configurable OTLP export.

Instrumentation scope:
- inbound HTTP (auto-instrumentation + request id correlation),
- background job execution spans,
- Garage Admin API call spans,
- S3 operation wrapper spans in API/worker services where practical,
- optional LDAP path spans where practical.

Out of scope:
- full custom distributed tracing backend deployment in-repo.

## 4) Integration Lane Flow

Decision:
- Keep fast lane and full integration lane split.
- Improve full lane scripts:
  - `integration:up` brings stack up and bootstraps Garage + app sync,
  - `integration:bootstrap` reruns bootstrap only,
  - `integration:test` runs full Playwright integration lane.
- Fix Garage service command and config for deterministic local runtime.

Full-lane sequence:
1. compose up (Postgres, Redis, Garage, API, Worker, Web)
2. wait for service readiness
3. run Garage bootstrap
4. run app-side health + bucket sync verification
5. execute integration Playwright scenarios

## 5) Worker Cancel Semantics and Step Logging

Decision:
- Keep best-effort cancellation model (no false hard-cancel claims).
- Add timeline events for:
  - cancel requested,
  - cancel observed at checkpoint,
  - step still in-flight when cancel cannot interrupt immediately.
- Add clearer worker step event logging around long operations.

## Rollout Risks

1. Prisma migration introduces new table/fields (`JobEvent`, correlation ids).
2. OTEL dependency/config mistakes can add startup noise; keep disabled-by-default toggles and safe fallbacks.
3. Bootstrap scripts depend on Docker CLI availability and integration compose service names.
4. Full integration lane can still be slow due container startup timing.

## Out of Scope (Intentional)

1. Per-object checkpoint resume for folder rename/delete jobs.
2. Hard interruption of already in-flight S3 requests (underlying protocol limits).
3. Replacing current worker model with heavyweight orchestration platform.
4. Kubernetes-only operational assumptions.
