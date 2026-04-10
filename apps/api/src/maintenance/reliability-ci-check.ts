import { randomUUID } from "node:crypto";

const config = {
  apiBaseUrl: process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:4000",
  username: process.env.INTEGRATION_ADMIN_USERNAME ?? "admin",
  password: process.env.INTEGRATION_ADMIN_PASSWORD ?? "change-me-now-please",
  bucket: process.env.INTEGRATION_BUCKET_NAME ?? "integration-bucket",
  contentionCalls: Number(process.env.INTEGRATION_RELIABILITY_CI_CONTENTION_CALLS ?? "4"),
  waitForTerminalMs: Number(process.env.INTEGRATION_RELIABILITY_CI_WAIT_FOR_TERMINAL_MS ?? "180000")
};

async function main() {
  log("Authenticating through API session flow...");
  const session = await login();

  log("Validating duplicate-safe run-once behavior under contention...");
  const calls = await Promise.all(
    Array.from({ length: Math.max(config.contentionCalls, 2) }).map((_, idx) =>
      apiJson<{
        task: string;
        result: "queued" | "skipped_active" | "failed" | "skipped_disabled";
        jobId: string | null;
        error: string | null;
      }>("/jobs/maintenance/tasks/upload_cleanup/run-once", {
        method: "POST",
        cookie: session.cookie,
        csrfToken: session.csrfToken,
        body: {},
        requestId: `ci-run-once-${idx}-${Date.now()}`
      })
    )
  );

  const queued = calls.filter((item) => item.result === "queued");
  const skippedActive = calls.filter((item) => item.result === "skipped_active");

  if (queued.length > 1) {
    throw new Error(`Expected at most one queued run-once result, got ${queued.length}`);
  }

  const trackedJobId = queued[0]?.jobId ?? skippedActive[0]?.jobId;
  if (!trackedJobId) {
    throw new Error("Expected at least one maintenance run-once call to point to an active/queued job");
  }

  log(`Tracking maintenance job ${trackedJobId} until terminal state...`);
  await waitForCondition(
    async () => {
      const job = await apiJson<{ status: string }>(`/jobs/${trackedJobId}`, {
        method: "GET",
        cookie: session.cookie
      });
      return job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELED";
    },
    config.waitForTerminalMs,
    "maintenance job terminal state"
  );

  log("Validating destructive folder-delete jobs remain non-retryable...");
  const folderPrefix = `stage7-ci-${Date.now()}-${randomUUID().slice(0, 8)}/`;

  const deleteQueued = await apiJson<{
    mode: string;
    job: {
      id: string;
      retryable: boolean;
      maxAttempts: number;
      status: string;
    };
  }>("/files", {
    method: "DELETE",
    cookie: session.cookie,
    csrfToken: session.csrfToken,
    body: {
      bucket: config.bucket,
      key: folderPrefix
    }
  });

  if (deleteQueued.mode !== "job") {
    throw new Error(`Expected folder delete to queue background job, got mode=${deleteQueued.mode}`);
  }

  if (deleteQueued.job.retryable !== false || deleteQueued.job.maxAttempts !== 1) {
    throw new Error(
      `Expected destructive job to be non-retryable (retryable=false,maxAttempts=1), got retryable=${deleteQueued.job.retryable}, maxAttempts=${deleteQueued.job.maxAttempts}`
    );
  }

  log(`Validating no duplicate terminal event for destructive job ${deleteQueued.job.id}...`);
  const detail = await waitForCondition(
    async () => {
      const value = await apiJson<{
        job: { status: string };
        events: Array<{ type: string }>;
      }>(`/jobs/${deleteQueued.job.id}/detail?limit=1000`, {
        method: "GET",
        cookie: session.cookie
      });

      const status = value.job.status;
      if (status !== "COMPLETED" && status !== "FAILED" && status !== "CANCELED") {
        return null;
      }

      return value;
    },
    config.waitForTerminalMs,
    "destructive job terminal state"
  );

  const terminalEvents = detail.events.filter(
    (event) => event.type === "completed" || event.type === "failed" || event.type === "canceled"
  );

  if (terminalEvents.length !== 1) {
    throw new Error(`Expected exactly one terminal event for destructive job, got ${terminalEvents.length}`);
  }

  log("Reliability CI checks passed.");
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
    method: "GET" | "POST" | "PATCH" | "DELETE";
    cookie: string;
    csrfToken?: string;
    body?: unknown;
    requestId?: string;
  }
): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: input.method,
    headers: {
      cookie: input.cookie,
      ...(input.csrfToken ? { "x-csrf-token": input.csrfToken } : {}),
      ...(input.requestId ? { "x-request-id": input.requestId } : {}),
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
  process.stdout.write(`[integration-reliability-ci] ${message}\n`);
}

main().catch((error) => {
  process.stderr.write(`[integration-reliability-ci] ERROR: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
