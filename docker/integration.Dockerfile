FROM node:22-alpine

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/s3/package.json packages/s3/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY . .
