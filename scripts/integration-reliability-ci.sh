#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${INTEGRATION_BUCKET_NAME:=integration-bucket}"

echo "[integration-reliability-ci] Ensuring integration bootstrap is complete..."
node ./scripts/integration-bootstrap.mjs

echo "[integration-reliability-ci] Running reliability v2 baseline scenarios..."
INTEGRATION_BUCKET_NAME="$INTEGRATION_BUCKET_NAME" npx pnpm --filter @s3gator/api integration:reliability:v2

echo "[integration-reliability-ci] Running deterministic Stage 7 CI reliability checks..."
INTEGRATION_BUCKET_NAME="$INTEGRATION_BUCKET_NAME" npx pnpm --filter @s3gator/api integration:reliability:ci
