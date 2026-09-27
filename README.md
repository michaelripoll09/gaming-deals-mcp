# Gaming Deals MCP

A local-first foundation for gaming purchase intelligence. This repository currently contains the shared runtime foundation only; product features are intentionally not implemented yet.

## Requirements

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`
- npm

## Setup and validation

Copy `env.example` to `.env` if you want to configure environment variables. The example contains no credentials; `DATABASE_PATH` is optional and provider credentials are not needed by this Foundation.

```sh
npm ci
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
npm run build
npm audit --audit-level moderate
```

## Foundation APIs

The public package entry point exports validated runtime configuration, safe application errors, UTC clock services, integer-minor-unit money, SQLite database initialization and migration support, and a closed typed settings store.

The SQLite connection enables foreign keys, WAL, a bounded busy timeout, and `synchronous = NORMAL`. Schema migrations are ordered, exclusive, transactional, and SHA-256 checksummed. Secrets are supplied through the process environment and are deliberately non-enumerable on runtime configuration objects.

This is not yet an MCP server, working CLI, dashboard, catalog, offer provider, scheduler, or game-deal product. Those capabilities belong to later implementation blocks.
