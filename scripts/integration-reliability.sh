#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${INTEGRATION_BUCKET_NAME:=integration-bucket}"

echo "[integration-reliability] Ensuring integration bootstrap is complete..."
node ./scripts/integration-bootstrap.mjs

echo "[integration-reliability] Running worker restart/reclaim reliability scenario..."
INTEGRATION_BUCKET_NAME="$INTEGRATION_BUCKET_NAME" npx pnpm --filter @s3gator/api integration:reliability
