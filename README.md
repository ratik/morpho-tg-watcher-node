# morpho-tg-watcher-node

Morpho Telegram watcher bot in Node.js/TypeScript.

See product/design intent in `docs/SPEC.md`.
Current implementation status is documented here and in `docs/STATUS.md`.

## Current state

Implemented:
- vault registry sync from Morpho GraphQL into SQLite
- initial vault preload on app start
- periodic vault refresh (`REGISTRY_TTL_SECONDS` / `morpho.registry_ttl_seconds`)
- Telegram bot with button-based UX
- subscription flow:
  - choose chain
  - enter search string
  - pick vault from paginated results
  - choose monitor type (`deposits` or `liquidity`)
  - enter threshold
- subscription management:
  - list subscriptions
  - edit threshold
  - remove subscription
- subscribed-vault metrics polling into SQLite
- initial metrics fetch on app start
- periodic metrics polling (`POLL_INTERVAL` / `polling.interval_seconds`)
- threshold alerts sent to Telegram when metric crosses from `>= threshold` to `< threshold`
- duplicate alert suppression using `subscriptions.last_alerted`
- alert persistence in SQLite
- pino logging

Partially implemented:
- metrics polling currently uses Morpho GraphQL state fields, not direct onchain multicall adapters yet
- manual script `poll_metrics:once` stores and prints metrics, but does not send alerts

Not implemented yet:
- v1/v2 onchain adapter layer
- multicall/RPC provider polling
- stale-metric protection
- recovery notifications when metric goes back above threshold
- admin/health flows
- Docker assets
- tests

## Runtime structure

```text
src/
  bot/
  config/
  db/
  morpho/
  notifier/
  onchain/
    adapters/
  registry/
  scripts/
  workers/
  index.ts
```

## Main scripts

- `npm run dev` - start app
- `npm run build` - compile TypeScript to `dist/`
- `npm run typecheck` - run TypeScript checks only
- `npm run get_vaults` - fetch and print Morpho vault list
- `npm run poll_metrics` - run continuous subscribed-vault metrics poller
- `npm run poll_metrics:once` - fetch/store/print subscribed-vault metrics once
- `npm test` - run test suite
- `npm run format` - format repository

## Configuration

Provide values via `.env` or `config.toml`.

Important variables:
- `TELEGRAM_TOKEN`
- `MORPHO_GQL_URL`
- `DB_PATH`
- `REGISTRY_TTL_SECONDS`
- `POLL_INTERVAL`
- `MAX_SUBSCRIPTIONS_PER_USER`
- `LOG_LEVEL`

Example config shape: `config.example.toml`

## SQLite tables in use

- `vaults`
- `subscriptions`
- `vault_metrics`
- `alerts`
- `locks`

## Notes

- Bot UI is button-first; slash commands are not required for normal use.
- Registry sync and metrics polling both use the shared Morpho GraphQL client in `src/morpho/client.ts`.
- The design spec still describes the intended target architecture; implementation has not fully reached that target yet.
