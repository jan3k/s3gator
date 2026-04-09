#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

: "${INTEGRATION_BUCKET_NAME:=integration-bucket}"

echo "[integration-test] Ensuring bootstrap is complete..."
node ./scripts/integration-bootstrap.mjs

echo "[integration-test] Running full integration Playwright lane..."
INTEGRATION_E2E=1 INTEGRATION_BUCKET_NAME="$INTEGRATION_BUCKET_NAME" npx pnpm test:e2e:integration
