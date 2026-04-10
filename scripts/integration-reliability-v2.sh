#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${INTEGRATION_BUCKET_NAME:=integration-bucket}"

echo "[integration-reliability-v2] Ensuring integration bootstrap is complete..."
node ./scripts/integration-bootstrap.mjs

echo "[integration-reliability-v2] Running baseline reclaim/restart reliability scenario..."
INTEGRATION_BUCKET_NAME="$INTEGRATION_BUCKET_NAME" npx pnpm --filter @s3gator/api integration:reliability

echo "[integration-reliability-v2] Running retry+restart+contention reliability scenario..."
INTEGRATION_BUCKET_NAME="$INTEGRATION_BUCKET_NAME" npx pnpm --filter @s3gator/api integration:reliability:v2
