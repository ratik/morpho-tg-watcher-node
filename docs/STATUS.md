# Implementation Status

This file describes the actual current state of the project, which may be behind or differ from the target architecture in `docs/SPEC.md`.

## Implemented

### Vault registry
- Fetches v1 and v2 vault lists from Morpho GraphQL
- Normalizes vault metadata
- Saves/upserts vaults into SQLite
- Runs initial sync on app startup
- Runs periodic refresh on configured interval

### Telegram bot
- Button-based main menu
- Add subscription flow:
  1. choose chain
  2. trigger search prompt
  3. enter search string
  4. choose vault from paginated results
  5. choose monitor type
  6. enter threshold
- List subscriptions
- Edit threshold
- Remove subscription
- Cancel flow and return to main menu

### Metrics polling
- Polls only vaults that currently have active subscriptions
- Fetches metrics from Morpho GraphQL
- Stores `deposits` and `available_liquidity` snapshots in `vault_metrics`
- Runs initial metrics fetch on app startup
- Runs periodic polling on configured interval

### Alerts
- Checks latest fetched metrics against active subscriptions
- Sends Telegram alerts on threshold crossing only:
  - previous state not alerted / at-or-above threshold
  - current state below threshold
- Uses `subscriptions.last_alerted` to suppress duplicates
- Clears `last_alerted` when metric goes back above threshold
- Stores sent alerts in `alerts`

### Logging
- Uses pino
- Logs startup, sync scheduling, poll cycles, counts, and failures

## Important current behavior

### Data source for metrics
Current metrics are pulled from Morpho GraphQL:
- v1:
  - deposits = `vault.state.totalAssets`
  - liquidity = `vault.liquidity.underlying`
- v2:
  - deposits = `vaultV2.totalAssets`
  - liquidity = `vaultV2.liquidity`

This is a temporary implementation relative to the target spec.

### Manual metrics script
- `npm run poll_metrics:once`
  - fetches metrics once
  - stores them in SQLite
  - prints them
  - does **not** send Telegram alerts
- `npm run poll_metrics`
  - runs the continuous loop
  - stores metrics
  - sends alerts

## Not implemented yet

### Onchain target architecture
- per-chain RPC provider pools
- multicall batching
- v1/v2 vault adapter layer
- direct onchain deposits/liquidity reads
- fallback RPC logic and retries/circuit breakers

### Reliability features
- stale metric handling
- recovery notifications
- health/admin flows
- leader lock usage for singleton jobs

### Ops/dev
- Docker assets
- automated tests
- CI

## Config in active use

Environment variables / config values currently used:
- `TELEGRAM_TOKEN`
- `MORPHO_GQL_URL`
- `DB_PATH`
- `REGISTRY_TTL_SECONDS`
- `POLL_INTERVAL`
- `MAX_SUBSCRIPTIONS_PER_USER`
- `LOG_LEVEL`
