# Observability Assets (Stage 6)

Date: 2026-04-10

## Included Assets

- Grafana dashboard JSON:
  - `ops/grafana/s3gator-stage6-operations.json`
- Prometheus alert rule examples:
  - `ops/prometheus/s3gator-alerts.yml`

These assets map to real metrics exposed by `GET /metrics`.

## Covered Signals

- login failures
- LDAP auth failures
- upload failures
- job failures
- retry scheduled/exhausted
- reclaim rate
- S3 failure trends
- retention cleanup failures
- scheduler task failures
- retained/deleted record counters

## Import Notes

1. Import dashboard JSON into Grafana.
2. Add alert rules file to Prometheus rule loading config.
3. Adjust thresholds to environment-specific baseline traffic.

## Metric Prerequisites

Ensure Prometheus scrapes API `/metrics` and that labels/job naming match your deployment (`up{job="s3gator-api"}` alert may require adaptation).
