#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const config = {
  garageContainer: process.env.INTEGRATION_GARAGE_CONTAINER ?? "s3gator-int-garage",
  garageConfigPath: process.env.INTEGRATION_GARAGE_CONFIG_PATH ?? "/etc/garage/config.toml",
  garageZone: process.env.INTEGRATION_GARAGE_ZONE ?? "dc1",
  garageCapacity: process.env.INTEGRATION_GARAGE_CAPACITY ?? "1G",
  adminToken:
    process.env.INTEGRATION_GARAGE_ADMIN_TOKEN ??
    process.env.GARAGE_ADMIN_TOKEN ??
    "stage4-dev-admin-token-change-me",
  adminUrl: process.env.INTEGRATION_GARAGE_ADMIN_URL ?? "http://127.0.0.1:3903",
  apiBaseUrl: process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:4000",
  accessKeyId: process.env.INTEGRATION_GARAGE_ACCESS_KEY_ID ?? "GK111111111111111111111111",
  secretAccessKey:
    process.env.INTEGRATION_GARAGE_SECRET_ACCESS_KEY ??
    "1111111111111111111111111111111111111111111111111111111111111111",
  keyName: process.env.INTEGRATION_GARAGE_KEY_NAME ?? "integration-app",
  bucketName: process.env.INTEGRATION_GARAGE_BUCKET_NAME ?? "s3gator-integration",
  bucketAlias: process.env.INTEGRATION_BUCKET_NAME ?? "integration-bucket",
  adminUsername:
    process.env.INTEGRATION_ADMIN_USERNAME ??
    process.env.DEFAULT_SUPER_ADMIN_USERNAME ??
    "admin",
  adminPassword:
    process.env.INTEGRATION_ADMIN_PASSWORD ??
    process.env.DEFAULT_SUPER_ADMIN_PASSWORD ??
    "change-me-now-please",
  timeoutMs: Number(process.env.INTEGRATION_BOOTSTRAP_TIMEOUT_MS ?? 180_000)
};

async function main() {
  log("Waiting for Garage admin API readiness...");
  await waitForGarageAdmin(config.timeoutMs);
  await ensureLayoutInitialized();
  await ensureAccessKey();
  await ensureBucketAndPermissions();

  log("Waiting for API readiness...");
  await waitForHttp(`${config.apiBaseUrl}/health/ready`, config.timeoutMs);

  const session = await loginApiAdmin();
  await verifyConnectionHealth(session);
  await runAndAwaitBucketSync(session);
  await verifyBucketVisible(session);

  log("Integration bootstrap finished successfully.");
  log(`Bucket alias ready: ${config.bucketAlias}`);
  log(`Access key id: ${config.accessKeyId}`);
}

async function verifyAdminToken() {
  const response = await fetch(`${config.adminUrl}/v2/GetClusterHealth`, {
    headers: {
      Authorization: `Bearer ${config.adminToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Garage admin token check failed: HTTP ${response.status} ${text}`);
  }
}

async function waitForGarageAdmin(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await verifyAdminToken();
      return;
    } catch {
      // retry until timeout
    }

    await sleep(1000);
  }

  throw new Error(`Timeout waiting for Garage admin API at ${config.adminUrl}`);
}

async function ensureLayoutInitialized() {
  log("Checking Garage layout state...");

  const statusOutput = stripAnsi(garage(["status"]));
  const nodeIds = [...statusOutput.matchAll(/^([a-f0-9]{16})\s+/gm)].map((match) => match[1]);
  if (nodeIds.length === 0) {
    throw new Error("No healthy Garage nodes detected in `garage status` output.");
  }

  const layoutOutput = stripAnsi(garage(["layout", "show"]));
  const versionMatch = /Current cluster layout version:\s*(\d+)/.exec(layoutOutput);
  const currentVersion = Number(versionMatch?.[1] ?? "0");
  const hasAssignedNode = nodeIds.some((nodeId) =>
    new RegExp(`^${nodeId}\\s+`, "m").test(layoutOutput)
  );

  if (hasAssignedNode && currentVersion > 0) {
    log(`Garage layout already initialized (version=${currentVersion}).`);
    return;
  }

  const firstNode = nodeIds[0];
  if (!firstNode) {
    throw new Error("Garage did not return any node id for layout initialization.");
  }

  log(`Initializing Garage layout for node ${firstNode}...`);
  garage(["layout", "assign", "-c", config.garageCapacity, "-z", config.garageZone, firstNode]);
  garage(["layout", "apply", "--version", String(currentVersion + 1)]);

  const updated = stripAnsi(garage(["layout", "show"]));
  if (!new RegExp(`^${firstNode}\\s+`, "m").test(updated)) {
    throw new Error("Garage layout initialization did not assign expected node.");
  }

  log("Garage layout initialized.");
}

async function ensureAccessKey() {
  log("Ensuring integration access key exists...");

  let infoOutput;
  try {
    infoOutput = stripAnsi(garage(["key", "info", config.accessKeyId, "--show-secret"]));
  } catch {
    garage([
      "key",
      "import",
      "--yes",
      "-n",
      config.keyName,
      config.accessKeyId,
      config.secretAccessKey
    ]);
    infoOutput = stripAnsi(garage(["key", "info", config.accessKeyId, "--show-secret"]));
  }

  const secretMatch = /Secret key:\s*([a-f0-9]{64})/i.exec(infoOutput);
  const resolvedSecret = secretMatch?.[1];
  if (!resolvedSecret) {
    throw new Error("Could not parse secret key from `garage key info` output.");
  }

  if (resolvedSecret !== config.secretAccessKey) {
    throw new Error(
      `Existing Garage key secret does not match configured integration secret for ${config.accessKeyId}.`
    );
  }

  log("Integration access key is ready.");
}

async function ensureBucketAndPermissions() {
  log("Ensuring integration bucket and alias exist...");

  try {
    garage(["bucket", "info", config.bucketName]);
  } catch {
    garage(["bucket", "create", config.bucketName]);
  }

  if (config.bucketAlias !== config.bucketName) {
    try {
      garage(["bucket", "alias", config.bucketName, config.bucketAlias]);
    } catch (error) {
      const message = String(error);
      if (!/already exists|already in use|already has/i.test(message)) {
        throw error;
      }
    }
  }

  garage([
    "bucket",
    "allow",
    "--read",
    "--write",
    "--owner",
    config.bucketName,
    "--key",
    config.accessKeyId
  ]);

  const bucketInfo = stripAnsi(garage(["bucket", "info", config.bucketName]));
  if (!bucketInfo.includes(config.bucketName) && !bucketInfo.includes(config.bucketAlias)) {
    throw new Error("Bucket info verification failed after bootstrap.");
  }

  log(`Integration bucket ready (name=${config.bucketName}, alias=${config.bucketAlias}).`);
}

async function loginApiAdmin() {
  log("Logging in through API for app-level verification...");

  const response = await fetch(`${config.apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: config.adminUsername,
      password: config.adminPassword,
      mode: "local"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API admin login failed: HTTP ${response.status} ${text}`);
  }

  const body = await response.json();
  const csrfToken = typeof body?.csrfToken === "string" ? body.csrfToken : null;
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0] ?? null;

  if (!cookie || !csrfToken) {
    throw new Error("API login did not return session cookie + CSRF token.");
  }

  return {
    cookie,
    csrfToken
  };
}

async function verifyConnectionHealth(session) {
  const connections = await apiFetchJson(`${config.apiBaseUrl}/admin/connections`, {
    method: "GET",
    headers: {
      cookie: session.cookie
    }
  });

  if (!Array.isArray(connections) || connections.length === 0) {
    throw new Error("No Garage connections found in app API.");
  }

  const defaultConnection = connections.find((item) => item?.isDefault) ?? connections[0];
  if (!defaultConnection?.id) {
    throw new Error("Could not resolve default connection id.");
  }

  const result = await apiFetchJson(
    `${config.apiBaseUrl}/admin/connections/${defaultConnection.id}/health`,
    {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
        "content-type": "application/json"
      },
      body: "{}"
    }
  );

  if (!result?.s3Ok) {
    throw new Error(`Connection health check failed: ${JSON.stringify(result)}`);
  }

  log(`Connection health check succeeded for ${defaultConnection.name ?? defaultConnection.id}.`);
}

async function runAndAwaitBucketSync(session) {
  log("Queueing and waiting for bucket sync job...");

  const job = await apiFetchJson(`${config.apiBaseUrl}/admin/buckets/sync`, {
    method: "POST",
    headers: {
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
      "content-type": "application/json"
    },
    body: "{}"
  });

  const jobId = job?.id;
  if (typeof jobId !== "string") {
    throw new Error(`Bucket sync did not return job id: ${JSON.stringify(job)}`);
  }

  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() < deadline) {
    const status = await apiFetchJson(`${config.apiBaseUrl}/jobs/${jobId}`, {
      method: "GET",
      headers: {
        cookie: session.cookie
      }
    });

    if (status?.status === "COMPLETED") {
      log("Bucket sync job completed.");
      return;
    }

    if (status?.status === "FAILED" || status?.status === "CANCELED") {
      throw new Error(
        `Bucket sync job ended with status=${status.status} (${status.failureSummary ?? "no summary"})`
      );
    }

    await sleep(1000);
  }

  throw new Error("Timed out waiting for bucket sync job completion.");
}

async function verifyBucketVisible(session) {
  const buckets = await apiFetchJson(`${config.apiBaseUrl}/admin/buckets`, {
    method: "GET",
    headers: {
      cookie: session.cookie
    }
  });

  if (!Array.isArray(buckets)) {
    throw new Error("Unexpected admin buckets response.");
  }

  const bucketNames = new Set(buckets.map((item) => item?.name).filter(Boolean));
  if (!bucketNames.has(config.bucketAlias) && !bucketNames.has(config.bucketName)) {
    throw new Error(
      `Expected bucket alias/name not visible in app after sync (wanted ${config.bucketAlias} or ${config.bucketName}).`
    );
  }

  log("App bucket visibility verified.");
}

function garage(args) {
  return exec("docker", [
    "exec",
    config.garageContainer,
    "/garage",
    "-c",
    config.garageConfigPath,
    ...args
  ]);
}

function exec(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const merged = `${stdout}\n${stderr}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${stripAnsi(merged)}`);
  }
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignored while waiting
    }

    await sleep(1000);
  }

  throw new Error(`Timeout waiting for ${url}`);
}

async function apiFetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text}`);
  }

  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stdout.write(`[integration-bootstrap] ${message}\n`);
}

main().catch((error) => {
  process.stderr.write(`[integration-bootstrap] ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
