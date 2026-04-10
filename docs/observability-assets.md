# Observability Assets (Stage 7)

Date: 2026-04-10

## Included Assets

- Grafana dashboard JSON:
  - `ops/grafana/dashboards/s3gator-stage7-operations.json`
- Grafana provisioning examples:
  - `ops/grafana/provisioning/dashboards/s3gator-dashboards.yml`
  - `ops/grafana/provisioning/datasources/s3gator-prometheus.yml`
- Prometheus alert rules:
  - `ops/prometheus/s3gator-alerts.yml`
- Alertmanager routing example:
  - `ops/alertmanager/s3gator-routing.example.yml`

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
- retention archived/deleted counters
- archive governance delete counters

## Validation

```bash
npx pnpm ops:validate-assets
```

## Import Notes

1. Import dashboard JSON into Grafana or mount with provisioning.
2. Add dashboard/datasource provisioning YAML under Grafana provisioning path.
3. Load Prometheus rule file from `ops/prometheus/s3gator-alerts.yml`.
4. Copy `ops/alertmanager/s3gator-routing.example.yml` and adapt receivers/routes.

## Metric Prerequisites

Ensure Prometheus scrapes API `/metrics` and adapt environment-specific target labels (`up{job="s3gator-api"}` may require adjustment).
