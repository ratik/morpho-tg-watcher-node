MORPHO Telegram Alert Bot — Design Spec

Summary
- Purpose: Telegram bot alerts users when deposits or available_liquidity of a Morpho vault fall below per-vault absolute thresholds.
- Users: traders, ops, liquidity managers who want notification for low-liquidity vaults across Ethereum, Base, Arbitrum.
- Key constraints: support any public Morpho vault; accurate onchain metrics; low false-positives; bot-only UX; SQLite storage for MVP.

High-level Architecture
- Implementation: NodeJS. GraphQL client for Morpho GraphQL endpoint. SQLite db. Provide Dockerfile so service runs as container; DB file and config.toml mounted as volumes.
- Registry-sync: fetch vault list from Morpho GraphQL endpoint every 30 minutes; cache in DB.
- Onchain-poller: per-chain poller that reads onchain metrics (deposits, available_liquidity) every 30s for vaults with subscribers. Uses multicall batching and VaultAdapter v1/v2.
- SQLite DB: persist vault registry, subscriptions, metrics, alerts, leader locks.
- Telegram Bot: command-based UX with interactive search (fuzzy, pagination) to subscribe/unsubscribe and view status.
- Notifier: compares latest metrics vs subscription thresholds; sends cross-only alerts when state crosses >= -> <; marks last_alerted to avoid duplicates.
- Worker orchestration: single service with multiple workers/processes or threads; leader election/locks for singleton tasks.

Components and Responsibilities
- Registry-sync
  - Input: Morpho GraphQL via @morpho-org/morpho-ts.
  - Action: fetch vault list every 30m, normalize metadata (chain, vault_id, token addr/symbol, decimals), upsert sqlite.vaults.
  - Cache TTL: 30m (configurable).

- VaultAdapter Interface
  - Methods: getDeposits(vault), getAvailableLiquidity(vault).
  - Implementations: v1 and v2 adapters that know contract layouts and calculation differences.
  - Return values: integer raw token units (not humanized).

- Onchain-poller
  - Polls only vaults with active subscriptions.
  - Uses per-chain multicall batches (configurable batch size; default 100).
  - Poll interval: default 30s (configurable).
  - Writes metrics to sqlite.vault_metrics with timestamp.
  - Stagger batches to smooth RPC QPS.

- Notifier
  - For each subscription: fetch latest metric, compare to stored threshold.
  - Cross-only rule: send alert only when previous state >= threshold and current < threshold.
  - Update subscription.last_alerted inside DB transaction before publishing to ensure idempotence.
  - Log alerts in alerts table.

- Telegram Bot UX
  - Searchable list (from sqlite.vaults) via inline keyboard, paginated (10 results/page), fuzzy match on symbol/name/address.
  - Interactive subscribe flow: select vault → enter threshold amount (humanized input) → confirm.
  - Commands: /subscribe, /unsubscribe, /my_subs, /status <vault_id>, /help, /health (admin).
  - Validate and echo humanized amounts with token symbol.

Data Model (SQLite)
- vaults(vault_id PK, chain, contract, token_addr, token_symbol, decimals, morpho_meta JSON, last_seen TIMESTAMP)
- subscriptions(id PK, user_id, chat_id, vault_id FK, threshold_amount INTEGER, decimals INTEGER, created_at TIMESTAMP, last_alerted BOOLEAN, active BOOLEAN)
- vault_metrics(id PK, vault_id FK, timestamp TIMESTAMP, deposits INTEGER, available_liquidity INTEGER)
- alerts(id PK, user_id, vault_id, threshold_amount INTEGER, alerted_at TIMESTAMP, cleared BOOLEAN, payload JSON)
- locks(job_name PK, owner, expires_at) -- simple leader-election

SQLite Operational Notes
- Use WAL mode, busy_timeout configured, single-writer pattern or lightweight leader election to avoid contention.
- Backups: nightly copy of sqlite file to object storage with rotation; encrypt backups if contain PII.

Polling & RPC Strategy
- Provider pool per-chain (env-configured RPC endpoints).
- Prefer multicall RPC for batching. Batch size configurable (default 100); tune per provider rate limits.
- Retries: exponential backoff with jitter. Circuit-breaker per provider.
- Fallback to single eth_call if multicall fails.
- Store raw integer token units; use decimals from registry to humanize in UI/messages.

Notifier Semantics
- Cross-only alerts:
  - If previous state >= threshold and current < threshold -> send alert; set last_alerted = true.
  - If current >= threshold -> clear last_alerted = false.
- Ensure DB transaction updates last_alerted before sending to avoid duplicate notifications from concurrent workers.

Error Handling & Reliability
- RPC: retries, circuit-breakers, multiple providers.
- GraphQL: retries for registry-sync; if registry stale, continue using cache.
- Metric staleness: mark metrics stale if older than 5x poll interval; skip alerting for stale metrics and optionally notify admin.
- Duplicate sends: prevented via transactional last_alerted update.
- Monitoring: expose exportable metrics (poll latency, rpc error count, queue sizes) and basic health endpoints.

Testing
- Unit tests: vault adapters (v1/v2), threshold logic, db migrations, bot command parsing.
- Integration tests: mainnet-fork for onchain adapters.
- E2E tests: Telegram test bot + mocked RPC for deterministic alert flows.
- CI: run unit + integration tests, lint, format.

Operational Configurations (env) / Config file
- TELEGRAM_TOKEN
- MORPHO_GQL_URL
- RPC_URLS_{ETH,BASE,ARBITRUM} (comma-separated or JSON)
- POLL_INTERVAL (seconds, default 30)
- MULTICALL_BATCH_SIZE (default 100)
- REGISTRY_TTL_SECONDS (default 1800)
- DB_PATH (path inside container; recommended to mount host file as volume)
- BACKUP_S3_URL (optional)
- MAX_SUBSCRIPTIONS_PER_USER (default 50)

Config file: support config.toml to declare providers, chains, poll intervals, batch sizes, and other runtime settings.

Docker runtime: provide Dockerfile and instructions so service runs as container. When running via Docker, mount config.toml and sqlite DB file as volumes into container.

Notes: run container with read-only config mount and writeable DB mount. Keep DB_PATH in config pointing to /data/db.sqlite.

Security & Privacy
- Sanitize all user inputs. Validate numeric inputs and token addresses.
- Store only necessary user data: user_id, chat_id, subscription metadata. Alert history retention default 90 days.
- Secure env secrets, rotate TELEGRAM_TOKEN and RPC keys regularly. Encrypt backups if PII present.

Scaling & Migration
- SQLite suitable for MVP. Plan migration to Postgres via ORM (knex/prisma) when scaling beyond single-node writes.
- Use provider pools and staggered polling to handle many vaults.

Rate Limiting & Abuse Protection
- Per-user subscription cap (default 50).
- Rate-limit bot commands per user to prevent spam.

Document history
- Created: 2026-04-14