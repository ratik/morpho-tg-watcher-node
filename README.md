# morpho-tg-watcher-node

Node.js scaffold for the Morpho Telegram Alert Bot described in `docs/SPEC.md`.

## Status

Project initialized only.

- No runtime implementation yet.
- Structure and dependencies are prepared from the current spec.
- `config.example.toml` reflects the documented runtime configuration shape.

## Planned structure

```text
src/
  app/
  bot/
  config/
  db/
  notifier/
  onchain/
    adapters/
  registry/
  workers/
  index.ts

tests/
  integration/
  unit/
```

## Scripts

- `npm run dev` - run entrypoint in watch-friendly TS runtime
- `npm run build` - compile TypeScript to `dist/`
- `npm run typecheck` - run TypeScript checks only
- `npm run get_vaults` - fetch and print Morpho vaults from configured GraphQL endpoint
- `npm test` - run test suite
- `npm run format` - format repository

## Configuration

Copy `config.example.toml` to `config.toml` and set `morpho.graphql_url`, or provide `MORPHO_GQL_URL` in the environment.

## Docker

The spec requires a containerized runtime with mounted `config.toml` and SQLite DB file. Docker assets are intentionally not implemented yet.
