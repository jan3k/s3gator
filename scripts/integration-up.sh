#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[integration-up] Starting integration stack..."
docker compose -f docker-compose.integration.yml up -d --build

echo "[integration-up] Running Garage + app bootstrap..."
node ./scripts/integration-bootstrap.mjs

echo "[integration-up] Integration stack is ready."
