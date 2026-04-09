# Integration Testing Lane

Date: 2026-04-09

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
npx pnpm integration:down
```

`integration:test` runs bootstrap first and then executes Playwright integration suite (`test/e2e-integration`).

## Integration E2E Coverage

Current scenarios validate:

1. local login and files page visibility
2. admin bucket sync queue visibility
3. bucket visibility + real upload + rename/delete job queueing
4. admin grant update flow
5. job timeline visibility in admin UI

## Notes

- Full lane keeps `INTEGRATION_E2E=1` gating internally in the integration test wrapper.
- If setup fails, check service logs with:

```bash
docker compose -f docker-compose.integration.yml logs api --tail=200
docker compose -f docker-compose.integration.yml logs worker --tail=200
docker compose -f docker-compose.integration.yml logs garage --tail=200
```
