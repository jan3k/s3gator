# Observability Provisioning

Date: 2026-04-10

## Included Assets

- Grafana dashboard:
  - `ops/grafana/dashboards/s3gator-stage7-operations.json`
- Grafana provisioning examples:
  - `ops/grafana/provisioning/dashboards/s3gator-dashboards.yml`
  - `ops/grafana/provisioning/datasources/s3gator-prometheus.yml`
- Prometheus alerts:
  - `ops/prometheus/s3gator-alerts.yml`
- Alertmanager routing example:
  - `ops/alertmanager/s3gator-routing.example.yml`

## Validation

```bash
npx pnpm ops:validate-assets
```

## Provisioning Notes

1. Mount dashboard JSON under Grafana dashboard path used by provisioning file.
2. Adapt Prometheus datasource URL for your environment.
3. Load Prometheus rule file in your Prometheus config.
4. Copy and customize Alertmanager routing example receivers/webhooks.

## Metric Alignment

All shipped assets reference metrics exported by `/metrics`, including Stage 7 archive-governance counters.
