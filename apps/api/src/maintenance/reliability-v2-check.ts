import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const config = {
  integrationComposeFile: resolveIntegrationComposeFile(),
  apiBaseUrl: process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:4000",
  username: process.env.INTEGRATION_ADMIN_USERNAME ?? "admin",
  password: process.env.INTEGRATION_ADMIN_PASSWORD ?? "change-me-now-please",
  primaryWorkerContainer: process.env.INTEGRATION_WORKER_CONTAINER ?? "s3gator-int-worker",
  secondaryWorkerContainer: process.env.INTEGRATION_SECONDARY_WORKER_CONTAINER ?? "s3gator-int-worker-2",
  waitForRetryMs: Number(process.env.INTEGRATION_RELIABILITY_V2_WAIT_FOR_RETRY_MS ?? "180000"),
  waitForCompletionMs: Number(process.env.INTEGRATION_RELIABILITY_V2_WAIT_FOR_COMPLETION_MS ?? "300000")
};

async function main() {
  log("Authenticating through API session flow...");
  const session = await login();

  const connections = await apiJson<Array<{ id: string; name: string; isDefault: boolean; adminApiUrl: string | null }>>(
    "/admin/connections",
    {
      method: "GET",
      cookie: session.cookie
    }
  );

  const defaultConnection = connections.find((item) => item.isDefault) ?? connections[0];
  if (!defaultConnection) {
    throw new Error("No connection available for reliability v2 test");
  }

  const originalAdminApiUrl = defaultConnection.adminApiUrl;
  const invalidAdminApiUrl = "http://127.0.0.1:9";

  log(`Patching default connection (${defaultConnection.id}) to invalid admin URL`);
  await apiJson(`/admin/connections/${defaultConnection.id}`, {
    method: "PATCH",
    cookie: session.cookie,
    csrfToken: session.csrfToken,
    body: {
      adminApiUrl: invalidAdminApiUrl
    }
  });

  let secondaryStarted = false;
  let primaryKilled = false;

  try {
    log("Queueing retryable BUCKET_SYNC job...");
    const queued = await apiJson<{ id: string }>("/admin/buckets/sync", {
      method: "POST",
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      body: {}
    });

    if (!queued?.id) {
      throw new Error("Bucket sync endpoint did not return job id");
    }

    const jobId = queued.id;
    log(`Queued job ${jobId}; waiting for first retry_scheduled event...`);

    await waitForCondition(
      async () => {
        const detail = await getJobDetail(session.cookie, jobId);
        const retryScheduledCount = detail.events.filter((event) => event.type === "retry_scheduled").length;
        return retryScheduledCount >= 1 ? detail : null;
      },
      config.waitForRetryMs,
      "first retry_scheduled"
    );

    runDocker(["rm", "-f", config.secondaryWorkerContainer], true);
    log(`Starting secondary worker container ${config.secondaryWorkerContainer}`);
    runDocker([
      "compose",
      "-f",
      config.integrationComposeFile,
      "run",
      "-d",
      "--name",
      config.secondaryWorkerContainer,
      "worker"
    ]);
    secondaryStarted = true;

    log(`Stopping primary worker container ${config.primaryWorkerContainer}`);
    runDocker(["stop", config.primaryWorkerContainer]);
    primaryKilled = true;

    log("Waiting for second retry_scheduled event (while primary worker is down)...");
    await waitForCondition(
      async () => {
        const detail = await getJobDetail(session.cookie, jobId);
        const retryScheduledCount = detail.events.filter((event) => event.type === "retry_scheduled").length;
        return retryScheduledCount >= 2 ? detail : null;
      },
      config.waitForRetryMs,
      "second retry_scheduled"
    );

    log(`Stopping secondary worker container ${config.secondaryWorkerContainer}`);
    runDocker(["rm", "-f", config.secondaryWorkerContainer]);
    secondaryStarted = false;

    log("Restoring valid admin API URL on default connection");
    await apiJson(`/admin/connections/${defaultConnection.id}`, {
      method: "PATCH",
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      body: {
        adminApiUrl: originalAdminApiUrl
      }
    });

    log(`Restarting primary worker container ${config.primaryWorkerContainer}`);
    runDocker(["start", config.primaryWorkerContainer]);
    primaryKilled = false;

    log("Waiting for terminal state after retry + restart + contention lifecycle...");
    const detail = await waitForCondition(
      async () => {
        const value = await getJobDetail(session.cookie, jobId);
        const status = value.job.status;
        if (status === "COMPLETED" || status === "FAILED" || status === "CANCELED") {
          return value;
        }
        return null;
      },
      config.waitForCompletionMs,
      "terminal job state"
    );

    const terminalEvents = detail.events.filter((event) =>
      event.type === "completed" || event.type === "failed" || event.type === "canceled"
    );

    if (terminalEvents.length !== 1) {
      throw new Error(`Expected exactly 1 terminal event, got ${terminalEvents.length}`);
    }

    const retryScheduledCount = detail.events.filter((event) => event.type === "retry_scheduled").length;
    if (retryScheduledCount < 2) {
      throw new Error(`Expected at least 2 retry_scheduled events, got ${retryScheduledCount}`);
    }

    const claimEvents = detail.events.filter((event) => event.type === "claimed");
    if (claimEvents.length < 2) {
      throw new Error(`Expected >=2 claim events across retries, got ${claimEvents.length}`);
    }

    if (detail.job.status === "FAILED") {
      const exhausted = detail.events.some((event) => event.type === "retry_exhausted");
      if (!exhausted) {
        throw new Error("Job failed but retry_exhausted event was not present");
      }
    }

    log(
      `Reliability v2 check passed: status=${detail.job.status}, retries=${retryScheduledCount}, claimEvents=${claimEvents.length}`
    );
  } finally {
    log("Restoring default connection Admin API URL (cleanup)");
    await apiJson(`/admin/connections/${defaultConnection.id}`, {
      method: "PATCH",
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      body: {
        adminApiUrl: originalAdminApiUrl
      }
    }).catch((error) => {
      log(`Cleanup warning (connection restore): ${(error as Error).message}`);
    });

    if (secondaryStarted) {
      runDocker(["rm", "-f", config.secondaryWorkerContainer], true);
    }

    if (primaryKilled) {
      runDocker(["start", config.primaryWorkerContainer], true);
    }
  }
}

async function getJobDetail(cookie: string, jobId: string) {
  return apiJson<{
    job: { status: string };
    events: Array<{
      type: string;
      metadata: Record<string, unknown> | null;
    }>;
  }>(`/jobs/${jobId}/detail?limit=1000`, {
    method: "GET",
    cookie
  });
}

async function login(): Promise<{ cookie: string; csrfToken: string }> {
  const csrfResp = await fetch(`${config.apiBaseUrl}/auth/csrf`, {
    method: "GET",
    redirect: "manual"
  });

  const csrfCookie = extractCookie(csrfResp.headers);

  const loginResp = await fetch(`${config.apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrfCookie
    },
    body: JSON.stringify({
      username: config.username,
      password: config.password
    })
  });

  if (!loginResp.ok) {
    const text = await loginResp.text();
    throw new Error(`Login failed: ${loginResp.status} ${text}`);
  }

  const loginPayload = (await loginResp.json()) as { csrfToken?: string };
  const loginCookie = extractCookie(loginResp.headers);
  const mergedCookie = [csrfCookie, loginCookie].filter(Boolean).join("; ");

  if (!loginPayload.csrfToken) {
    throw new Error("Login response did not include csrfToken");
  }

  return {
    cookie: mergedCookie,
    csrfToken: loginPayload.csrfToken
  };
}

async function apiJson<T>(
  path: string,
  input: {
    method: "GET" | "POST" | "PATCH";
    cookie: string;
    csrfToken?: string;
    body?: unknown;
  }
): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: input.method,
    headers: {
      cookie: input.cookie,
      ...(input.csrfToken ? { "x-csrf-token": input.csrfToken } : {}),
      ...(input.body !== undefined ? { "content-type": "application/json" } : {})
    },
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function extractCookie(headers: Headers): string {
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter((value): value is string => Boolean(value));

  return cookies
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("; ");
}

function runDocker(args: string[], ignoreFailure = false): void {
  try {
    execFileSync("docker", args, { stdio: ignoreFailure ? "pipe" : "inherit" });
  } catch (error) {
    if (!ignoreFailure) {
      throw error;
    }
  }
}

async function waitForCondition<T>(
  fn: () => Promise<T | null | false>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await fn();
    if (value) {
      return value;
    }
    await sleep(1500);
  }

  throw new Error(`Timeout waiting for ${label} (${timeoutMs}ms)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  process.stdout.write(`[integration-reliability-v2] ${message}\n`);
}

function resolveIntegrationComposeFile(): string {
  const explicit = process.env.INTEGRATION_COMPOSE_FILE;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "docker-compose.integration.yml"),
    resolve(process.cwd(), "../docker-compose.integration.yml"),
    resolve(process.cwd(), "../../docker-compose.integration.yml"),
    resolve(scriptDir, "../../../..", "docker-compose.integration.yml"),
    resolve(scriptDir, "../../../../..", "docker-compose.integration.yml")
  ];

  const found = candidates.find((item) => existsSync(item));
  if (found) {
    return found;
  }

  return explicit ?? "docker-compose.integration.yml";
}

main().catch((error) => {
  process.stderr.write(`[integration-reliability-v2] ERROR: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
