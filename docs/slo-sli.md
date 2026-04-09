# SLI / SLO First Pass (Stage 5)

Date: 2026-04-09

## Purpose

Provide practical operator targets and queryable signals based on existing Prometheus metrics and timeline events.

## Core SLIs

1. Login success rate
2. Upload completion rate
3. Job success rate
4. Bucket sync success rate
5. Readiness availability
6. Retry exhaustion rate

## Suggested SLO Targets (Starting Point)

- Login success rate: >= 99.5% (excluding invalid credential noise when tracked separately)
- Upload completion rate: >= 99.0%
- Job success rate (all types): >= 99.0%
- Bucket sync success rate: >= 99.0%
- Readiness availability: >= 99.9%

Tune these by environment and operational baseline.

## Metric Mapping

- login:
  - `s3gator_login_total{result="success|failure",method=...}`
- upload:
  - `s3gator_upload_events_total{event="start|complete|fail|abort"}`
- jobs:
  - `s3gator_jobs_total{type=...,status="start|complete|fail|cancel"}`
  - `s3gator_job_retries_total{type=...,event="scheduled|started|exhausted|skipped_non_retryable"}`
  - `s3gator_job_reclaims_total{type=...}`
- readiness:
  - scrape success on `/health/ready`
- S3/LDAP pressure signals:
  - `s3gator_s3_failures_total`
  - `s3gator_ldap_auth_failures_total`

## Example PromQL

Login success rate (5m):

```promql
sum(rate(s3gator_login_total{result="success"}[5m]))
/
sum(rate(s3gator_login_total[5m]))
```

Upload completion ratio (15m):

```promql
sum(rate(s3gator_upload_events_total{event="complete"}[15m]))
/
sum(rate(s3gator_upload_events_total{event="start"}[15m]))
```

Job failure ratio (15m):

```promql
sum(rate(s3gator_jobs_total{status="fail"}[15m]))
/
sum(rate(s3gator_jobs_total{status="start"}[15m]))
```

Retry exhaustion count (15m):

```promql
sum(increase(s3gator_job_retries_total{event="exhausted"}[15m]))
```

## Alert Suggestions

- readiness degraded for > 5m
- retry exhaustion spikes for retryable job types
- upload failure ratio above threshold
- sustained increase in `s3gator_s3_failures_total`
- sustained LDAP auth failures above baseline

## Scope Boundaries

- This is a practical Stage 5 baseline, not a complete SRE platform.
- Dashboards/alerts should be adapted to real traffic patterns.
