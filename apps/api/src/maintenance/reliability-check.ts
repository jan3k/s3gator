import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execFileSync } from "node:child_process";

const config = {
  apiBaseUrl: process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:4000",
  garageEndpoint: process.env.INTEGRATION_GARAGE_ENDPOINT ?? "http://127.0.0.1:3900",
  garageRegion: process.env.INTEGRATION_GARAGE_REGION ?? "garage",
  forcePathStyle: readBoolean(process.env.INTEGRATION_GARAGE_FORCE_PATH_STYLE, true),
  accessKeyId: process.env.INTEGRATION_GARAGE_ACCESS_KEY_ID ?? "GK111111111111111111111111",
  secretAccessKey:
    process.env.INTEGRATION_GARAGE_SECRET_ACCESS_KEY ??
    "1111111111111111111111111111111111111111111111111111111111111111",
  bucket: process.env.INTEGRATION_BUCKET_NAME ?? "integration-bucket",
  username: process.env.INTEGRATION_ADMIN_USERNAME ?? "admin",
  password: process.env.INTEGRATION_ADMIN_PASSWORD ?? "change-me-now-please",
  workerContainer: process.env.INTEGRATION_WORKER_CONTAINER ?? "s3gator-int-worker",
  fileCount: Number(process.env.INTEGRATION_RELIABILITY_FILE_COUNT ?? "120"),
  waitForRunningMs: Number(process.env.INTEGRATION_RELIABILITY_WAIT_FOR_RUNNING_MS ?? "30000"),
  waitForTerminalMs: Number(process.env.INTEGRATION_RELIABILITY_WAIT_FOR_TERMINAL_MS ?? "240000"),
  lockTtlSeconds: Number(process.env.INTEGRATION_JOB_LOCK_TTL_SECONDS ?? "20")
};

async function main() {
  const folder = `stage5-reliability-${Date.now()}/`;
  const renamedFolder = `${folder}renamed/`;

  log(`Uploading ${config.fileCount} objects to ${config.bucket}/${folder} ...`);
  await uploadObjects(folder, config.fileCount);

  log("Authenticating through API session flow...");
  const session = await login();

  log("Queueing folder rename job...");
  const queued = await apiJson<{ mode: string; job: { id: string } }>("/files/rename", {
    method: "POST",
    cookie: session.cookie,
    csrfToken: session.csrfToken,
    body: {
      bucket: config.bucket,
      oldKey: folder,
      newKey: renamedFolder
    }
  });

  if (!queued?.job?.id) {
    throw new Error("Rename endpoint did not return job id");
  }

  const jobId = queued.job.id;
  log(`Queued job ${jobId}; waiting for RUNNING state before interruption...`);

  await waitForCondition(
    async () => {
      const job = await apiJson<{ status: string }>(`/jobs/${jobId}`, {
        method: "GET",
        cookie: session.cookie
      });
      return job.status === "RUNNING";
    },
    config.waitForRunningMs,
    "job to enter RUNNING state"
  );

  log(`Killing worker container ${config.workerContainer} to simulate crash...`);
  runDocker(["kill", config.workerContainer]);

  const waitMs = (config.lockTtlSeconds + 4) * 1000;
  log(`Waiting ${waitMs}ms for lock TTL expiry...`);
  await sleep(waitMs);

  log("Restarting worker container...");
  runDocker(["start", config.workerContainer]);

  log("Waiting for job terminal state after reclaim...");
  const detail = await waitForCondition(
    async () => {
      const value = await apiJson<{ job: { status: string }; events: Array<{ type: string; metadata: Record<string, unknown> | null }> }>(
        `/jobs/${jobId}/detail?limit=1000`,
        {
          method: "GET",
          cookie: session.cookie
        }
      );

      const status = value.job.status;
      if (status === "COMPLETED" || status === "FAILED" || status === "CANCELED") {
        return value;
      }
      return null;
    },
    config.waitForTerminalMs,
    "job to reach terminal state"
  );

  const terminalEvents = detail.events.filter((event) =>
    event.type === "completed" || event.type === "failed" || event.type === "canceled"
  );

  if (terminalEvents.length !== 1) {
    throw new Error(`Expected exactly 1 terminal event, got ${terminalEvents.length}`);
  }

  const reclaimed = detail.events.some((event) => {
    if (event.type === "reclaimed") {
      return true;
    }
    if (event.type !== "claimed") {
      return false;
    }
    const metadata = event.metadata ?? {};
    return metadata.reclaimedStaleRun === true;
  });

  if (!reclaimed) {
    throw new Error("Expected reclaim signal in job timeline, but none was found");
  }

  log(`Reliability check passed: job ${jobId} status=${detail.job.status}`);
}

async function uploadObjects(prefix: string, count: number): Promise<void> {
  const s3 = new S3Client({
    endpoint: config.garageEndpoint,
    region: config.garageRegion,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  for (let i = 0; i < count; i += 1) {
    const key = `${prefix}obj-${String(i).padStart(4, "0")}.txt`;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: `stage5 reliability object ${i}`,
        ContentType: "text/plain"
      })
    );
  }
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
    method: "GET" | "POST";
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
      ...(input.body ? { "content-type": "application/json" } : {})
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

function extractCookie(headers: Headers): string {
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter((value): value is string => Boolean(value));

  return cookies
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("; ");
}

function runDocker(args: string[]): void {
  execFileSync("docker", args, { stdio: "inherit" });
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

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function log(message: string): void {
  process.stdout.write(`[integration-reliability] ${message}\n`);
}

main().catch((error) => {
  process.stderr.write(`[integration-reliability] ERROR: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
