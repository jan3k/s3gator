#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "ops/grafana/dashboards/s3gator-stage7-operations.json",
  "ops/grafana/provisioning/dashboards/s3gator-dashboards.yml",
  "ops/grafana/provisioning/datasources/s3gator-prometheus.yml",
  "ops/prometheus/s3gator-alerts.yml",
  "ops/alertmanager/s3gator-routing.example.yml"
];

for (const file of requiredFiles) {
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    fail(`Missing required ops asset: ${file}`);
  }
}

const dashboardRaw = readFileSync(resolve(process.cwd(), requiredFiles[0]), "utf8");
let dashboard;
try {
  dashboard = JSON.parse(dashboardRaw);
} catch (error) {
  fail(`Dashboard JSON parse failed: ${(error).message}`);
}

if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
  fail("Dashboard JSON has no panels.");
}

const alertsRaw = readFileSync(resolve(process.cwd(), "ops/prometheus/s3gator-alerts.yml"), "utf8");
for (const metric of [
  "s3gator_jobs_total",
  "s3gator_job_retries_total",
  "s3gator_job_reclaims_total",
  "s3gator_archive_governance_deleted_records_total"
]) {
  if (!alertsRaw.includes(metric)) {
    fail(`Alert rules do not reference expected metric: ${metric}`);
  }
}

process.stdout.write("Ops assets validation passed.\n");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
