# Integration Testing Lane

Date: 2026-04-10

## Lanes

### Fast lane

```bash
npx pnpm lint
npx pnpm typecheck
npx pnpm test
npx pnpm test:e2e
```

### Full integration lane

Uses real stack:

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
npx pnpm integration:reliability:ci
npx pnpm integration:down
```

`integration:up` includes deterministic Garage/app bootstrap.

## Playwright Integration Coverage

`integration:test` validates at least:

1. local login and files page visibility
2. admin bucket sync queue visibility
3. bucket visibility + real upload + post-upload listing behavior
4. rename/delete background-job flow visibility
5. admin grant update flow
6. job timeline visibility in admin UI

## Reliability Coverage

`integration:reliability:ci` provides deterministic Stage 7 checks suitable for CI as a dedicated reliability lane.

## Debugging

```bash
docker compose -f docker-compose.integration.yml logs api --tail=200
docker compose -f docker-compose.integration.yml logs worker --tail=200
docker compose -f docker-compose.integration.yml logs garage --tail=200
```
