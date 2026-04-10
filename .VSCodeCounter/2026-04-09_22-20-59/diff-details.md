# Diff Details

Date : 2026-04-09 22:20:59

Directory /home/jaugustyniak/Documents/repos/github/s3gator

Total : 44 files,  3261 codes, 2 comments, 680 blanks, all 3943 lines

[Summary](results.md) / [Details](details.md) / [Diff Summary](diff.md) / Diff Details

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [README.md](/README.md) | Markdown | -1 | 0 | 3 | 2 |
| [apps/api/package.json](/apps/api/package.json) | JSON | 3 | 0 | 0 | 3 |
| [apps/api/prisma/migrations/20260409220000\_stage5\_retention\_retry/migration.sql](/apps/api/prisma/migrations/20260409220000_stage5_retention_retry/migration.sql) | MS SQL | 19 | 0 | 3 | 22 |
| [apps/api/src/audit/audit.controller.ts](/apps/api/src/audit/audit.controller.ts) | TypeScript | 7 | 0 | 1 | 8 |
| [apps/api/src/audit/audit.service.ts](/apps/api/src/audit/audit.service.ts) | TypeScript | 43 | 0 | 2 | 45 |
| [apps/api/src/auth/auth.service.ts](/apps/api/src/auth/auth.service.ts) | TypeScript | 38 | 0 | 2 | 40 |
| [apps/api/src/authorization/authorization.module.ts](/apps/api/src/authorization/authorization.module.ts) | TypeScript | 1 | 0 | 0 | 1 |
| [apps/api/src/buckets/buckets.module.ts](/apps/api/src/buckets/buckets.module.ts) | TypeScript | 2 | 0 | 0 | 2 |
| [apps/api/src/common/common.module.ts](/apps/api/src/common/common.module.ts) | TypeScript | 8 | 0 | 2 | 10 |
| [apps/api/src/common/crypto.service.ts](/apps/api/src/common/crypto.service.ts) | TypeScript | 3 | 0 | 0 | 3 |
| [apps/api/src/common/env.ts](/apps/api/src/common/env.ts) | TypeScript | 13 | 0 | 0 | 13 |
| [apps/api/src/common/request-context.test.ts](/apps/api/src/common/request-context.test.ts) | TypeScript | 21 | 0 | 4 | 25 |
| [apps/api/src/files/files.module.ts](/apps/api/src/files/files.module.ts) | TypeScript | 4 | 0 | 0 | 4 |
| [apps/api/src/health/health.module.ts](/apps/api/src/health/health.module.ts) | TypeScript | 2 | 0 | 0 | 2 |
| [apps/api/src/jobs/job-retention.service.test.ts](/apps/api/src/jobs/job-retention.service.test.ts) | TypeScript | 69 | 0 | 13 | 82 |
| [apps/api/src/jobs/job-retention.service.ts](/apps/api/src/jobs/job-retention.service.ts) | TypeScript | 155 | 0 | 19 | 174 |
| [apps/api/src/jobs/jobs.controller.ts](/apps/api/src/jobs/jobs.controller.ts) | TypeScript | 26 | 0 | 3 | 29 |
| [apps/api/src/jobs/jobs.module.ts](/apps/api/src/jobs/jobs.module.ts) | TypeScript | 1 | 0 | 0 | 1 |
| [apps/api/src/jobs/jobs.service.test.ts](/apps/api/src/jobs/jobs.service.test.ts) | TypeScript | 217 | 0 | 16 | 233 |
| [apps/api/src/jobs/jobs.service.ts](/apps/api/src/jobs/jobs.service.ts) | TypeScript | 169 | 0 | 15 | 184 |
| [apps/api/src/jobs/jobs.worker.service.test.ts](/apps/api/src/jobs/jobs.worker.service.test.ts) | TypeScript | 55 | 0 | 4 | 59 |
| [apps/api/src/jobs/jobs.worker.service.ts](/apps/api/src/jobs/jobs.worker.service.ts) | TypeScript | 61 | 0 | 10 | 71 |
| [apps/api/src/maintenance/reliability-check.ts](/apps/api/src/maintenance/reliability-check.ts) | TypeScript | 222 | 0 | 40 | 262 |
| [apps/api/src/maintenance/run-retention.ts](/apps/api/src/maintenance/run-retention.ts) | TypeScript | 17 | 0 | 4 | 21 |
| [apps/api/src/metrics/metrics.service.test.ts](/apps/api/src/metrics/metrics.service.test.ts) | TypeScript | 13 | 0 | 0 | 13 |
| [apps/api/src/metrics/metrics.service.ts](/apps/api/src/metrics/metrics.service.ts) | TypeScript | 43 | 0 | 8 | 51 |
| [apps/web/app/admin/page.tsx](/apps/web/app/admin/page.tsx) | TypeScript JSX | 52 | 0 | 2 | 54 |
| [docker-compose.integration.yml](/docker-compose.integration.yml) | YAML | 26 | 0 | -1 | 25 |
| [docs/architecture.md](/docs/architecture.md) | Markdown | 47 | 0 | 10 | 57 |
| [docs/data-retention.md](/docs/data-retention.md) | Markdown | 31 | 0 | 16 | 47 |
| [docs/garage-bootstrap.md](/docs/garage-bootstrap.md) | Markdown | 40 | 0 | 20 | 60 |
| [docs/integration-testing.md](/docs/integration-testing.md) | Markdown | 50 | 0 | 21 | 71 |
| [docs/operations.md](/docs/operations.md) | Markdown | 31 | 0 | 12 | 43 |
| [docs/reliability.md](/docs/reliability.md) | Markdown | 28 | 0 | 14 | 42 |
| [docs/security.md](/docs/security.md) | Markdown | -26 | 0 | -3 | -29 |
| [docs/slo-sli.md](/docs/slo-sli.md) | Markdown | 64 | 0 | 24 | 88 |
| [docs/stage5-plan.md](/docs/stage5-plan.md) | Markdown | 98 | 0 | 39 | 137 |
| [docs/telemetry.md](/docs/telemetry.md) | Markdown | 32 | 0 | 17 | 49 |
| [package.json](/package.json) | JSON | 2 | 0 | 0 | 2 |
| [packages/shared/src/types.ts](/packages/shared/src/types.ts) | TypeScript | 5 | 0 | 0 | 5 |
| [pnpm-lock.yaml](/pnpm-lock.yaml) | YAML | 1,540 | 0 | 352 | 1,892 |
| [scripts/integration-bootstrap.mjs](/scripts/integration-bootstrap.mjs) | JavaScript | 11 | 1 | 2 | 14 |
| [scripts/integration-reliability.sh](/scripts/integration-reliability.sh) | Shell Script | 8 | 1 | 5 | 14 |
| [test/e2e-integration/stack.spec.ts](/test/e2e-integration/stack.spec.ts) | TypeScript | 11 | 0 | 1 | 12 |

[Summary](results.md) / [Details](details.md) / [Diff Summary](diff.md) / Diff Details