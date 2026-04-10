# Integration Testing Lane

Date: 2026-04-10

## Test Lanes

## Fast lane

Runs quickly without full dependency stack:

```bash
npx pnpm lint
npx pnpm typecheck
npx pnpm test
npx pnpm test:e2e
```

## Full integration lane

Runs against real stack:

- PostgreSQL
- Redis
- Garage v2.2.0
- API
- Worker
- Web

Commands:

```bash
npx pnpm integration:up
npx pnpm integration:test
npx pnpm integration:reliability
npx pnpm integration:reliability:v2
npx pnpm integration:down
```

`integration:test` runs bootstrap first and then executes Playwright integration suite (`test/e2e-integration`).
`integration:reliability` runs bootstrap and then executes worker interruption/reclaim validation (`apps/api/src/maintenance/reliability-check.ts`).
`integration:reliability:v2` runs baseline reclaim scenario and then retry+restart+contention scenario (`apps/api/src/maintenance/reliability-v2-check.ts`).

## Integration E2E Coverage

Current scenarios validate:

1. local login and files page visibility
2. admin bucket sync queue visibility
3. bucket visibility + real upload + rename/delete job queueing
4. admin grant update flow
5. job timeline visibility in admin UI

## Reliability Coverage

`integration:reliability` validates:

1. queue long-running folder rename job
2. interrupt worker container while job is running
3. restart worker after lock TTL window
4. verify reclaim signal in job timeline
5. verify single terminal completion event (no duplicate finalization)

`integration:reliability:v2` additionally validates:

1. retryable bucket sync reschedule path
2. restart during retry lifecycle
3. multi-worker claim contention
4. coherent retry timeline and single terminal event invariants

## Notes

- Full lane keeps `INTEGRATION_E2E=1` gating internally in the integration test wrapper.
- If setup fails, check service logs with:

```bash
docker compose -f docker-compose.integration.yml logs api --tail=200
docker compose -f docker-compose.integration.yml logs worker --tail=200
docker compose -f docker-compose.integration.yml logs garage --tail=200
```
