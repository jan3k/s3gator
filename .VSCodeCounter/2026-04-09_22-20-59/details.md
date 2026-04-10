# Details

Date : 2026-04-09 22:20:59

Directory /home/jaugustyniak/Documents/repos/github/s3gator

Total : 159 files,  20521 codes, 16 comments, 3893 blanks, all 24430 lines

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [.dockerignore](/.dockerignore) | Ignore | 8 | 0 | 1 | 9 |
| [README.md](/README.md) | Markdown | 135 | 0 | 47 | 182 |
| [apps/api/package.json](/apps/api/package.json) | JSON | 56 | 0 | 1 | 57 |
| [apps/api/prisma/migrations/20260409160000\_init/migration.sql](/apps/api/prisma/migrations/20260409160000_init/migration.sql) | MS SQL | 132 | 2 | 16 | 150 |
| [apps/api/prisma/migrations/20260409173000\_stage3\_resilience/migration.sql](/apps/api/prisma/migrations/20260409173000_stage3_resilience/migration.sql) | MS SQL | 37 | 0 | 6 | 43 |
| [apps/api/prisma/migrations/20260409190000\_stage4\_observability\_bootstrap/migration.sql](/apps/api/prisma/migrations/20260409190000_stage4_observability_bootstrap/migration.sql) | MS SQL | 17 | 0 | 4 | 21 |
| [apps/api/prisma/migrations/20260409220000\_stage5\_retention\_retry/migration.sql](/apps/api/prisma/migrations/20260409220000_stage5_retention_retry/migration.sql) | MS SQL | 19 | 0 | 3 | 22 |
| [apps/api/src/app.controller.ts](/apps/api/src/app.controller.ts) | TypeScript | 13 | 0 | 2 | 15 |
| [apps/api/src/app.module.ts](/apps/api/src/app.module.ts) | TypeScript | 55 | 0 | 2 | 57 |
| [apps/api/src/audit/audit.controller.ts](/apps/api/src/audit/audit.controller.ts) | TypeScript | 21 | 0 | 4 | 25 |
| [apps/api/src/audit/audit.module.ts](/apps/api/src/audit/audit.module.ts) | TypeScript | 9 | 0 | 2 | 11 |
| [apps/api/src/audit/audit.service.ts](/apps/api/src/audit/audit.service.ts) | TypeScript | 150 | 0 | 21 | 171 |
| [apps/api/src/auth/auth.controller.test.ts](/apps/api/src/auth/auth.controller.test.ts) | TypeScript | 104 | 0 | 17 | 121 |
| [apps/api/src/auth/auth.controller.ts](/apps/api/src/auth/auth.controller.ts) | TypeScript | 121 | 0 | 22 | 143 |
| [apps/api/src/auth/auth.module.ts](/apps/api/src/auth/auth.module.ts) | TypeScript | 14 | 0 | 2 | 16 |
| [apps/api/src/auth/auth.service.test.ts](/apps/api/src/auth/auth.service.test.ts) | TypeScript | 86 | 0 | 16 | 102 |
| [apps/api/src/auth/auth.service.ts](/apps/api/src/auth/auth.service.ts) | TypeScript | 213 | 0 | 31 | 244 |
| [apps/api/src/auth/csrf.guard.ts](/apps/api/src/auth/csrf.guard.ts) | TypeScript | 28 | 0 | 10 | 38 |
| [apps/api/src/auth/current-user.decorator.ts](/apps/api/src/auth/current-user.decorator.ts) | TypeScript | 7 | 0 | 2 | 9 |
| [apps/api/src/auth/ldap-auth.service.ts](/apps/api/src/auth/ldap-auth.service.ts) | TypeScript | 113 | 0 | 18 | 131 |
| [apps/api/src/auth/login-rate-limiter.service.test.ts](/apps/api/src/auth/login-rate-limiter.service.test.ts) | TypeScript | 54 | 0 | 13 | 67 |
| [apps/api/src/auth/login-rate-limiter.service.ts](/apps/api/src/auth/login-rate-limiter.service.ts) | TypeScript | 34 | 0 | 9 | 43 |
| [apps/api/src/auth/session-auth.guard.ts](/apps/api/src/auth/session-auth.guard.ts) | TypeScript | 40 | 0 | 9 | 49 |
| [apps/api/src/auth/session.service.ts](/apps/api/src/auth/session.service.ts) | TypeScript | 80 | 0 | 12 | 92 |
| [apps/api/src/authorization/authorization.module.ts](/apps/api/src/authorization/authorization.module.ts) | TypeScript | 10 | 0 | 2 | 12 |
| [apps/api/src/authorization/authorization.service.test.ts](/apps/api/src/authorization/authorization.service.test.ts) | TypeScript | 69 | 0 | 10 | 79 |
| [apps/api/src/authorization/authorization.service.ts](/apps/api/src/authorization/authorization.service.ts) | TypeScript | 86 | 0 | 13 | 99 |
| [apps/api/src/authorization/bucket-permission.guard.ts](/apps/api/src/authorization/bucket-permission.guard.ts) | TypeScript | 27 | 0 | 6 | 33 |
| [apps/api/src/authorization/permission.decorator.ts](/apps/api/src/authorization/permission.decorator.ts) | TypeScript | 18 | 0 | 4 | 22 |
| [apps/api/src/authorization/role.decorator.ts](/apps/api/src/authorization/role.decorator.ts) | TypeScript | 4 | 0 | 3 | 7 |
| [apps/api/src/authorization/role.guard.ts](/apps/api/src/authorization/role.guard.ts) | TypeScript | 25 | 0 | 5 | 30 |
| [apps/api/src/bootstrap/seed.ts](/apps/api/src/bootstrap/seed.ts) | TypeScript | 172 | 1 | 31 | 204 |
| [apps/api/src/buckets/buckets.controller.ts](/apps/api/src/buckets/buckets.controller.ts) | TypeScript | 110 | 0 | 15 | 125 |
| [apps/api/src/buckets/buckets.module.ts](/apps/api/src/buckets/buckets.module.ts) | TypeScript | 13 | 0 | 2 | 15 |
| [apps/api/src/buckets/buckets.service.test.ts](/apps/api/src/buckets/buckets.service.test.ts) | TypeScript | 93 | 0 | 12 | 105 |
| [apps/api/src/buckets/buckets.service.ts](/apps/api/src/buckets/buckets.service.ts) | TypeScript | 272 | 0 | 39 | 311 |
| [apps/api/src/common/common.module.ts](/apps/api/src/common/common.module.ts) | TypeScript | 8 | 0 | 2 | 10 |
| [apps/api/src/common/crypto.service.ts](/apps/api/src/common/crypto.service.ts) | TypeScript | 50 | 1 | 12 | 63 |
| [apps/api/src/common/env.ts](/apps/api/src/common/env.ts) | TypeScript | 65 | 0 | 4 | 69 |
| [apps/api/src/common/public.decorator.ts](/apps/api/src/common/public.decorator.ts) | TypeScript | 3 | 0 | 3 | 6 |
| [apps/api/src/common/request-context.test.ts](/apps/api/src/common/request-context.test.ts) | TypeScript | 21 | 0 | 4 | 25 |
| [apps/api/src/common/request-context.ts](/apps/api/src/common/request-context.ts) | TypeScript | 30 | 0 | 7 | 37 |
| [apps/api/src/connections/connections.controller.ts](/apps/api/src/connections/connections.controller.ts) | TypeScript | 63 | 0 | 8 | 71 |
| [apps/api/src/connections/connections.module.ts](/apps/api/src/connections/connections.module.ts) | TypeScript | 11 | 0 | 2 | 13 |
| [apps/api/src/connections/connections.service.test.ts](/apps/api/src/connections/connections.service.test.ts) | TypeScript | 89 | 0 | 14 | 103 |
| [apps/api/src/connections/connections.service.ts](/apps/api/src/connections/connections.service.ts) | TypeScript | 283 | 0 | 35 | 318 |
| [apps/api/src/files/files.controller.ts](/apps/api/src/files/files.controller.ts) | TypeScript | 288 | 0 | 44 | 332 |
| [apps/api/src/files/files.module.ts](/apps/api/src/files/files.module.ts) | TypeScript | 13 | 0 | 2 | 15 |
| [apps/api/src/files/files.service.test.ts](/apps/api/src/files/files.service.test.ts) | TypeScript | 307 | 0 | 42 | 349 |
| [apps/api/src/files/files.service.ts](/apps/api/src/files/files.service.ts) | TypeScript | 654 | 0 | 91 | 745 |
| [apps/api/src/health/health.controller.test.ts](/apps/api/src/health/health.controller.test.ts) | TypeScript | 28 | 0 | 8 | 36 |
| [apps/api/src/health/health.controller.ts](/apps/api/src/health/health.controller.ts) | TypeScript | 28 | 0 | 4 | 32 |
| [apps/api/src/health/health.module.ts](/apps/api/src/health/health.module.ts) | TypeScript | 11 | 0 | 2 | 13 |
| [apps/api/src/health/health.service.test.ts](/apps/api/src/health/health.service.test.ts) | TypeScript | 40 | 0 | 12 | 52 |
| [apps/api/src/health/health.service.ts](/apps/api/src/health/health.service.ts) | TypeScript | 31 | 0 | 7 | 38 |
| [apps/api/src/jobs/job-retention.service.test.ts](/apps/api/src/jobs/job-retention.service.test.ts) | TypeScript | 69 | 0 | 13 | 82 |
| [apps/api/src/jobs/job-retention.service.ts](/apps/api/src/jobs/job-retention.service.ts) | TypeScript | 155 | 0 | 19 | 174 |
| [apps/api/src/jobs/jobs.controller.ts](/apps/api/src/jobs/jobs.controller.ts) | TypeScript | 106 | 0 | 19 | 125 |
| [apps/api/src/jobs/jobs.module.ts](/apps/api/src/jobs/jobs.module.ts) | TypeScript | 15 | 0 | 2 | 17 |
| [apps/api/src/jobs/jobs.service.test.ts](/apps/api/src/jobs/jobs.service.test.ts) | TypeScript | 345 | 0 | 31 | 376 |
| [apps/api/src/jobs/jobs.service.ts](/apps/api/src/jobs/jobs.service.ts) | TypeScript | 711 | 0 | 114 | 825 |
| [apps/api/src/jobs/jobs.worker.service.test.ts](/apps/api/src/jobs/jobs.worker.service.test.ts) | TypeScript | 175 | 0 | 22 | 197 |
| [apps/api/src/jobs/jobs.worker.service.ts](/apps/api/src/jobs/jobs.worker.service.ts) | TypeScript | 623 | 0 | 86 | 709 |
| [apps/api/src/main.ts](/apps/api/src/main.ts) | TypeScript | 104 | 0 | 19 | 123 |
| [apps/api/src/maintenance/reliability-check.ts](/apps/api/src/maintenance/reliability-check.ts) | TypeScript | 222 | 0 | 40 | 262 |
| [apps/api/src/maintenance/run-retention.ts](/apps/api/src/maintenance/run-retention.ts) | TypeScript | 17 | 0 | 4 | 21 |
| [apps/api/src/metrics/metrics.controller.test.ts](/apps/api/src/metrics/metrics.controller.test.ts) | TypeScript | 17 | 0 | 7 | 24 |
| [apps/api/src/metrics/metrics.controller.ts](/apps/api/src/metrics/metrics.controller.ts) | TypeScript | 13 | 0 | 3 | 16 |
| [apps/api/src/metrics/metrics.module.ts](/apps/api/src/metrics/metrics.module.ts) | TypeScript | 10 | 0 | 2 | 12 |
| [apps/api/src/metrics/metrics.service.test.ts](/apps/api/src/metrics/metrics.service.test.ts) | TypeScript | 35 | 0 | 5 | 40 |
| [apps/api/src/metrics/metrics.service.ts](/apps/api/src/metrics/metrics.service.ts) | TypeScript | 163 | 0 | 34 | 197 |
| [apps/api/src/prisma/prisma.module.ts](/apps/api/src/prisma/prisma.module.ts) | TypeScript | 8 | 0 | 2 | 10 |
| [apps/api/src/prisma/prisma.service.ts](/apps/api/src/prisma/prisma.service.ts) | TypeScript | 11 | 0 | 3 | 14 |
| [apps/api/src/redis/redis.module.ts](/apps/api/src/redis/redis.module.ts) | TypeScript | 8 | 0 | 2 | 10 |
| [apps/api/src/redis/redis.service.ts](/apps/api/src/redis/redis.service.ts) | TypeScript | 153 | 0 | 33 | 186 |
| [apps/api/src/settings/settings.controller.ts](/apps/api/src/settings/settings.controller.ts) | TypeScript | 47 | 0 | 7 | 54 |
| [apps/api/src/settings/settings.module.ts](/apps/api/src/settings/settings.module.ts) | TypeScript | 11 | 0 | 2 | 13 |
| [apps/api/src/settings/settings.service.test.ts](/apps/api/src/settings/settings.service.test.ts) | TypeScript | 81 | 0 | 10 | 91 |
| [apps/api/src/settings/settings.service.ts](/apps/api/src/settings/settings.service.ts) | TypeScript | 141 | 0 | 15 | 156 |
| [apps/api/src/telemetry/otel.ts](/apps/api/src/telemetry/otel.ts) | TypeScript | 75 | 0 | 17 | 92 |
| [apps/api/src/users/users.controller.ts](/apps/api/src/users/users.controller.ts) | TypeScript | 65 | 0 | 8 | 73 |
| [apps/api/src/users/users.module.ts](/apps/api/src/users/users.module.ts) | TypeScript | 11 | 0 | 2 | 13 |
| [apps/api/src/users/users.service.test.ts](/apps/api/src/users/users.service.test.ts) | TypeScript | 110 | 0 | 13 | 123 |
| [apps/api/src/users/users.service.ts](/apps/api/src/users/users.service.ts) | TypeScript | 226 | 0 | 30 | 256 |
| [apps/api/src/worker.ts](/apps/api/src/worker.ts) | TypeScript | 40 | 0 | 10 | 50 |
| [apps/api/tsconfig.build.json](/apps/api/tsconfig.build.json) | JSON | 11 | 0 | 1 | 12 |
| [apps/api/tsconfig.json](/apps/api/tsconfig.json) | JSON with Comments | 17 | 0 | 1 | 18 |
| [apps/api/vitest.config.ts](/apps/api/vitest.config.ts) | TypeScript | 12 | 0 | 2 | 14 |
| [apps/web/app/admin/page.tsx](/apps/web/app/admin/page.tsx) | TypeScript JSX | 888 | 0 | 72 | 960 |
| [apps/web/app/files/page.tsx](/apps/web/app/files/page.tsx) | TypeScript JSX | 724 | 2 | 62 | 788 |
| [apps/web/app/globals.css](/apps/web/app/globals.css) | PostCSS | 34 | 0 | 7 | 41 |
| [apps/web/app/layout.tsx](/apps/web/app/layout.tsx) | TypeScript JSX | 36 | 0 | 3 | 39 |
| [apps/web/app/login/page.tsx](/apps/web/app/login/page.tsx) | TypeScript JSX | 137 | 0 | 21 | 158 |
| [apps/web/app/page.tsx](/apps/web/app/page.tsx) | TypeScript JSX | 4 | 0 | 2 | 6 |
| [apps/web/components/providers.tsx](/apps/web/components/providers.tsx) | TypeScript JSX | 17 | 0 | 4 | 21 |
| [apps/web/lib/api-client.ts](/apps/web/lib/api-client.ts) | TypeScript | 54 | 0 | 15 | 69 |
| [apps/web/lib/multipart-upload.test.ts](/apps/web/lib/multipart-upload.test.ts) | TypeScript | 106 | 0 | 14 | 120 |
| [apps/web/lib/multipart-upload.ts](/apps/web/lib/multipart-upload.ts) | TypeScript | 135 | 0 | 30 | 165 |
| [apps/web/lib/utils.ts](/apps/web/lib/utils.ts) | TypeScript | 5 | 0 | 2 | 7 |
| [apps/web/next-env.d.ts](/apps/web/next-env.d.ts) | TypeScript | 1 | 4 | 2 | 7 |
| [apps/web/next.config.ts](/apps/web/next.config.ts) | TypeScript | 6 | 0 | 3 | 9 |
| [apps/web/package.json](/apps/web/package.json) | JSON | 39 | 0 | 1 | 40 |
| [apps/web/postcss.config.mjs](/apps/web/postcss.config.mjs) | JavaScript | 5 | 0 | 1 | 6 |
| [apps/web/tsconfig.json](/apps/web/tsconfig.json) | JSON with Comments | 18 | 0 | 1 | 19 |
| [docker-compose.dev.yml](/docker-compose.dev.yml) | YAML | 33 | 0 | 4 | 37 |
| [docker-compose.integration.yml](/docker-compose.integration.yml) | YAML | 195 | 0 | 7 | 202 |
| [docker/integration.Dockerfile](/docker/integration.Dockerfile) | Docker | 11 | 0 | 6 | 17 |
| [docs/architecture.md](/docs/architecture.md) | Markdown | 136 | 0 | 50 | 186 |
| [docs/data-retention.md](/docs/data-retention.md) | Markdown | 31 | 0 | 16 | 47 |
| [docs/discovery.md](/docs/discovery.md) | Markdown | 94 | 0 | 36 | 130 |
| [docs/garage-bootstrap.md](/docs/garage-bootstrap.md) | Markdown | 40 | 0 | 20 | 60 |
| [docs/integration-testing.md](/docs/integration-testing.md) | Markdown | 50 | 0 | 21 | 71 |
| [docs/operations.md](/docs/operations.md) | Markdown | 85 | 0 | 34 | 119 |
| [docs/reliability.md](/docs/reliability.md) | Markdown | 28 | 0 | 14 | 42 |
| [docs/security.md](/docs/security.md) | Markdown | 60 | 0 | 23 | 83 |
| [docs/slo-sli.md](/docs/slo-sli.md) | Markdown | 64 | 0 | 24 | 88 |
| [docs/stage2-hardening-plan.md](/docs/stage2-hardening-plan.md) | Markdown | 122 | 0 | 39 | 161 |
| [docs/stage3-plan.md](/docs/stage3-plan.md) | Markdown | 115 | 0 | 38 | 153 |
| [docs/stage4-plan.md](/docs/stage4-plan.md) | Markdown | 85 | 0 | 27 | 112 |
| [docs/stage5-plan.md](/docs/stage5-plan.md) | Markdown | 98 | 0 | 39 | 137 |
| [docs/telemetry.md](/docs/telemetry.md) | Markdown | 32 | 0 | 17 | 49 |
| [eslint.config.mjs](/eslint.config.mjs) | JavaScript | 36 | 0 | 2 | 38 |
| [package.json](/package.json) | JSON | 39 | 0 | 1 | 40 |
| [packages/s3/package.json](/packages/s3/package.json) | JSON | 25 | 0 | 1 | 26 |
| [packages/s3/src/admin-client.ts](/packages/s3/src/admin-client.ts) | TypeScript | 104 | 0 | 17 | 121 |
| [packages/s3/src/client.ts](/packages/s3/src/client.ts) | TypeScript | 14 | 0 | 2 | 16 |
| [packages/s3/src/file-service.ts](/packages/s3/src/file-service.ts) | TypeScript | 635 | 0 | 87 | 722 |
| [packages/s3/src/index.ts](/packages/s3/src/index.ts) | TypeScript | 5 | 0 | 1 | 6 |
| [packages/s3/src/types.ts](/packages/s3/src/types.ts) | TypeScript | 161 | 0 | 25 | 186 |
| [packages/s3/src/utils.test.ts](/packages/s3/src/utils.test.ts) | TypeScript | 26 | 0 | 7 | 33 |
| [packages/s3/src/utils.ts](/packages/s3/src/utils.ts) | TypeScript | 111 | 0 | 9 | 120 |
| [packages/s3/tsconfig.build.json](/packages/s3/tsconfig.build.json) | JSON | 10 | 0 | 1 | 11 |
| [packages/s3/vitest.config.ts](/packages/s3/vitest.config.ts) | TypeScript | 7 | 0 | 2 | 9 |
| [packages/shared/package.json](/packages/shared/package.json) | JSON | 17 | 0 | 1 | 18 |
| [packages/shared/src/index.ts](/packages/shared/src/index.ts) | TypeScript | 4 | 0 | 1 | 5 |
| [packages/shared/src/permissions.ts](/packages/shared/src/permissions.ts) | TypeScript | 31 | 0 | 3 | 34 |
| [packages/shared/src/roles.ts](/packages/shared/src/roles.ts) | TypeScript | 2 | 0 | 2 | 4 |
| [packages/shared/src/schemas.ts](/packages/shared/src/schemas.ts) | TypeScript | 68 | 0 | 11 | 79 |
| [packages/shared/src/types.ts](/packages/shared/src/types.ts) | TypeScript | 89 | 0 | 11 | 100 |
| [packages/shared/tsconfig.build.json](/packages/shared/tsconfig.build.json) | JSON | 8 | 0 | 1 | 9 |
| [packages/ui/package.json](/packages/ui/package.json) | JSON | 25 | 0 | 1 | 26 |
| [packages/ui/src/components/empty-state.tsx](/packages/ui/src/components/empty-state.tsx) | TypeScript JSX | 12 | 0 | 2 | 14 |
| [packages/ui/src/components/page-shell.tsx](/packages/ui/src/components/page-shell.tsx) | TypeScript JSX | 20 | 0 | 3 | 23 |
| [packages/ui/src/components/permission-badge.tsx](/packages/ui/src/components/permission-badge.tsx) | TypeScript JSX | 16 | 0 | 3 | 19 |
| [packages/ui/src/index.ts](/packages/ui/src/index.ts) | TypeScript | 3 | 0 | 1 | 4 |
| [packages/ui/tsconfig.build.json](/packages/ui/tsconfig.build.json) | JSON | 9 | 0 | 1 | 10 |
| [playwright.config.ts](/playwright.config.ts) | TypeScript | 30 | 0 | 2 | 32 |
| [playwright.integration.config.ts](/playwright.integration.config.ts) | TypeScript | 21 | 0 | 2 | 23 |
| [pnpm-lock.yaml](/pnpm-lock.yaml) | YAML | 6,674 | 0 | 1,623 | 8,297 |
| [pnpm-workspace.yaml](/pnpm-workspace.yaml) | YAML | 3 | 0 | 1 | 4 |
| [scripts/dev-bootstrap.sh](/scripts/dev-bootstrap.sh) | Shell Script | 18 | 1 | 9 | 28 |
| [scripts/integration-bootstrap.mjs](/scripts/integration-bootstrap.mjs) | JavaScript | 337 | 2 | 68 | 407 |
| [scripts/integration-reliability.sh](/scripts/integration-reliability.sh) | Shell Script | 8 | 1 | 5 | 14 |
| [scripts/integration-test.sh](/scripts/integration-test.sh) | Shell Script | 8 | 1 | 5 | 14 |
| [scripts/integration-up.sh](/scripts/integration-up.sh) | Shell Script | 8 | 1 | 5 | 14 |
| [test/e2e-integration/stack.spec.ts](/test/e2e-integration/stack.spec.ts) | TypeScript | 87 | 0 | 20 | 107 |
| [test/e2e/files-authenticated.spec.ts](/test/e2e/files-authenticated.spec.ts) | TypeScript | 57 | 0 | 6 | 63 |
| [test/e2e/login-page.spec.ts](/test/e2e/login-page.spec.ts) | TypeScript | 8 | 0 | 2 | 10 |
| [tsconfig.base.json](/tsconfig.base.json) | JSON | 22 | 0 | 1 | 23 |

[Summary](results.md) / Details / [Diff Summary](diff.md) / [Diff Details](diff-details.md)