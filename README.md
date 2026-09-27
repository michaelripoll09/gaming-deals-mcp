# Gaming Deals MCP

A local-first foundation for gaming purchase intelligence. This repository contains the shared runtime foundation and canonical catalog domain: opaque internal identity; a persisted Game → Release → Edition → Product graph; separate platform family/variant and distribution context; product compositions; and persistent provider-product mapping states. External provider IDs remain mapping provenance, not canonical identity.

## Requirements

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`
- npm

## Setup and validation

Copy `env.example` to `.env` if you want to configure environment variables. The example contains no credentials; `DATABASE_PATH` is optional and provider credentials are not needed by the Foundation or catalog domain.

```sh
npm ci
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
npm run build
npm audit --audit-level moderate
```

## Implemented APIs

The public package entry point exports validated runtime configuration, safe application errors, UTC clock services, integer-minor-unit money, SQLite database initialization and migration support, a closed typed settings store, and `CoreServices.catalog` for the canonical catalog domain.

The SQLite connection enables foreign keys, sets a bounded busy timeout before WAL mode, and uses `synchronous = NORMAL`. Schema migrations are ordered, exclusive, transactional, and SHA-256 checksummed. Migration 001 creates `app_settings` with `key`, JSON-encoded `value_json`, and UTC ISO `updated_at` columns. Migration 002 adds the persisted catalog hierarchy, compositions, and provider-product mappings with relational constraints. Settings are parsed and validated against their known types on both reads and writes; unknown keys and corrupt stored values fail safely.

The canonical preference key is `timezone` (an IANA time zone). The clock returns a numeric Unix timestamp; timestamps are converted to UTC ISO-8601 only when persisted. Secrets, when later required by a provider, must come from environment variables or a local `.env` file and must never be persisted in settings or exposed to the frontend. This Foundation has no provider-specific credentials.

Provider adapters and real external providers, offers/pricing, wishlist/ownership records, an MCP server, CLI, dashboard, and scheduler do not exist yet. Provider credentials and network access are not required.
