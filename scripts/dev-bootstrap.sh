#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Update secrets before production use."
fi

echo "Starting PostgreSQL + Redis..."
docker compose -f docker-compose.dev.yml up -d postgres redis

echo "Installing dependencies..."
npx pnpm install

echo "Generating Prisma client..."
npx pnpm db:generate

echo "Running Prisma migrations..."
npx pnpm db:migrate

echo "Seeding roles/permissions/admin..."
npx pnpm db:seed

echo "Bootstrap completed."
