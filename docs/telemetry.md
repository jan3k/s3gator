# Telemetry and Correlation IDs

Date: 2026-04-09

## Correlation IDs

API assigns a request correlation ID per request (default header: `x-request-id`).

Propagation:

- request context (`AsyncLocalStorage`)
- API logs (pino)
- audit metadata context
- persisted jobs (`jobs.correlationId`)
- persisted job events (`job_events.correlationId`)
- worker execution context

## OpenTelemetry

OTEL is integrated in API and worker startup.

### Environment variables

- `OTEL_ENABLED=true|false`
- `OTEL_SERVICE_NAME=s3gator-api` (or worker-specific name)
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector>:4318/v1/traces`
- `OTEL_EXPORTER_OTLP_HEADERS=key=value,key2=value2`

### Instrumented paths

- inbound HTTP requests (auto instrumentation)
- background job execution spans
- Garage Admin API request spans (`packages/s3` admin client)
- selected S3 operation spans in file service
- auth flow spans (login path)

## Metrics and Health

- Metrics endpoint: `GET /metrics`
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`

Use metrics for alerting and traces for deep request/job diagnostics.

## Boundaries

- Instrumentation is pragmatic, not exhaustive for every internal helper call.
- Correlation IDs are designed for operational debugging, not secret-bearing payload transport.
