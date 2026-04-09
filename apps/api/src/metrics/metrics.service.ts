import { Injectable } from "@nestjs/common";
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics
} from "prom-client";

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly loginCounter: Counter<"result" | "method">;
  private readonly loginLatency: Histogram<"result" | "method">;

  private readonly uploadCounter: Counter<"event">;
  private readonly uploadLatency: Histogram<"event">;

  private readonly jobCounter: Counter<"type" | "status">;
  private readonly jobLatency: Histogram<"type" | "status">;

  private readonly s3FailureCounter: Counter<"operation">;
  private readonly s3Latency: Histogram<"operation">;

  private readonly ldapFailureCounter: Counter<"reason">;

  constructor() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: "s3gator_"
    });

    this.loginCounter = new Counter({
      name: "s3gator_login_total",
      help: "Login attempts grouped by result/method",
      labelNames: ["result", "method"],
      registers: [this.registry]
    });

    this.loginLatency = new Histogram({
      name: "s3gator_login_duration_seconds",
      help: "Login flow duration",
      labelNames: ["result", "method"],
      buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
      registers: [this.registry]
    });

    this.uploadCounter = new Counter({
      name: "s3gator_upload_events_total",
      help: "Multipart upload lifecycle events",
      labelNames: ["event"],
      registers: [this.registry]
    });

    this.uploadLatency = new Histogram({
      name: "s3gator_upload_event_duration_seconds",
      help: "Upload lifecycle durations",
      labelNames: ["event"],
      buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry]
    });

    this.jobCounter = new Counter({
      name: "s3gator_jobs_total",
      help: "Background job lifecycle events",
      labelNames: ["type", "status"],
      registers: [this.registry]
    });

    this.jobLatency = new Histogram({
      name: "s3gator_job_duration_seconds",
      help: "Background job durations",
      labelNames: ["type", "status"],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry]
    });

    this.s3FailureCounter = new Counter({
      name: "s3gator_s3_failures_total",
      help: "S3 operation failures",
      labelNames: ["operation"],
      registers: [this.registry]
    });

    this.s3Latency = new Histogram({
      name: "s3gator_s3_operation_duration_seconds",
      help: "S3 operation durations",
      labelNames: ["operation"],
      buckets: [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry]
    });

    this.ldapFailureCounter = new Counter({
      name: "s3gator_ldap_auth_failures_total",
      help: "LDAP authentication failures",
      labelNames: ["reason"],
      registers: [this.registry]
    });
  }

  recordLogin(result: "success" | "failure", method: "local" | "ldap" | "unknown", durationSeconds?: number): void {
    this.loginCounter.inc({ result, method });
    if (durationSeconds !== undefined) {
      this.loginLatency.observe({ result, method }, durationSeconds);
    }
  }

  recordUploadEvent(event: "start" | "complete" | "fail" | "abort", durationSeconds?: number): void {
    this.uploadCounter.inc({ event });
    if (durationSeconds !== undefined) {
      this.uploadLatency.observe({ event }, durationSeconds);
    }
  }

  recordJobEvent(type: string, status: "start" | "complete" | "fail" | "cancel", durationSeconds?: number): void {
    this.jobCounter.inc({ type, status });
    if (durationSeconds !== undefined) {
      this.jobLatency.observe({ type, status }, durationSeconds);
    }
  }

  recordS3Failure(operation: string): void {
    this.s3FailureCounter.inc({ operation });
  }

  recordS3Duration(operation: string, durationSeconds: number): void {
    this.s3Latency.observe({ operation }, durationSeconds);
  }

  recordLdapFailure(reason: string): void {
    this.ldapFailureCounter.inc({ reason: normalizeLabelValue(reason) });
  }

  async renderMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  metricsContentType(): string {
    return this.registry.contentType;
  }
}

function normalizeLabelValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64) || "unknown";
}
