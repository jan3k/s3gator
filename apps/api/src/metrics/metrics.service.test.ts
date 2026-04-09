import { describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.service.js";

describe("MetricsService", () => {
  it("exposes prometheus metrics with stage3 counters", async () => {
    const service = new MetricsService();

    service.recordLogin("success", "local", 0.2);
    service.recordUploadEvent("start");
    service.recordUploadEvent("complete", 1.2);
    service.recordJobEvent("FOLDER_DELETE", "start");
    service.recordJobEvent("FOLDER_DELETE", "complete", 2.5);
    service.recordJobRetryEvent("BUCKET_SYNC", "scheduled");
    service.recordJobRetryEvent("BUCKET_SYNC", "started");
    service.recordJobRetryEvent("FOLDER_DELETE", "skipped_non_retryable");
    service.recordJobRetryEvent("BUCKET_SYNC", "exhausted");
    service.recordJobReclaim("FOLDER_RENAME");
    service.recordS3Failure("folder_delete");
    service.recordS3Duration("folder_delete", 0.8);
    service.recordLdapFailure("invalid credentials");
    service.recordRetentionCleanup("success");
    service.recordRetentionDeleted("job_events", 10);
    service.recordRetentionDeleted("jobs", 2);
    service.recordRetentionDeleted("upload_sessions", 0);

    const output = await service.renderMetrics();

    expect(output).toContain("s3gator_login_total");
    expect(output).toContain("s3gator_upload_events_total");
    expect(output).toContain("s3gator_jobs_total");
    expect(output).toContain("s3gator_job_retries_total");
    expect(output).toContain("s3gator_job_reclaims_total");
    expect(output).toContain("s3gator_retention_cleanup_total");
    expect(output).toContain("s3gator_retention_deleted_records_total");
    expect(output).toContain("s3gator_s3_failures_total");
    expect(output).toContain("s3gator_ldap_auth_failures_total");
    expect(service.metricsContentType()).toContain("text/plain");
  });
});
