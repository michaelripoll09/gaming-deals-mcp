# Phase 1: PC Deal Core Design

Phase 1 establishes the smallest persistent, end-to-end Gaming Deals MCP flow. It validates canonical product identity, provider isolation, regional eligibility, price history, wishlist operations, and explainable offer selection before the project expands to additional platforms and product capabilities.

## Outcome

An MCP client can search a deterministic PC catalog, persist normalized offers and price observations, manage a local wishlist, compare eligible offers for Colombia, and receive an explanation for the selected best offer. The same provider contract can then onboard the first permitted real provider without creating a second application path.

## Constraints

- Runtime: Node.js 22 or newer.
- Language and modules: TypeScript with ESM.
- Package manager: pnpm.
- Validation: Zod at configuration and external boundaries.
- Persistence: SQLite with versioned migrations.
- Testing: Vitest.
- Default installation profile: country `CO`, comparison currency `COP`.
- Country and currency remain installation configuration, never domain constants.
- The implementation is a single-package modular monolith.
- Buying remains manual; the application only returns safe destination URLs.

## Architecture

```text
MCP / CLI
   |
   v
Application services
   |
   v
Domain contracts
   |
   v
Provider and persistence ports
   |
   v
Deterministic provider / SQLite / future real providers
```

User-facing adapters may depend on application services. Application services depend on domain contracts and ports. Provider and persistence adapters implement those ports. The domain never imports MCP, CLI, SQLite, or provider-specific modules.

The repository remains a single deployable package. Module boundaries are enforced through imports and public interfaces rather than premature workspace packages.

## Modules

| Module | Responsibility |
| --- | --- |
| `config` | Load and validate installation configuration without exposing secrets. |
| `catalog` | Own canonical game, release, edition, and product-variant identity. |
| `offers` | Own provider listings, current offers, and immutable price observations. |
| `providers` | Define capability contracts and adapt deterministic or external sources. |
| `pricing` | Evaluate regional eligibility, normalize currency, and compare offers. |
| `wishlist` | Persist and manage the initial local wishlist. |
| `application` | Orchestrate use cases independently of MCP, CLI, and SQLite. |
| `mcp` | Expose validated MCP tools and safe public errors. |
| `cli` | Start runtime commands and expose the initial `doctor` diagnostics. |
| `persistence` | Own migrations and SQLite implementations of application ports. |

## Canonical commercial model

```text
Game
└── Release
    └── Edition
        └── ProductVariant
            └── ProviderListing
                └── Offer
                    └── PriceObservation
```

- **Game** identifies the conceptual work.
- **Release** distinguishes materially different releases, including remakes.
- **Edition** identifies a commercial edition such as Standard or Deluxe.
- **ProductVariant** fixes platform, distribution, and regional product context.
- **ProviderListing** maps a provider-owned identifier to a canonical product variant.
- **Offer** represents the provider's current purchasable terms.
- **PriceObservation** is an immutable timestamped record used for history.

Provider mappings have `verified`, `probable`, `ambiguous`, or `unmatched` state. Only `verified` mappings participate in definitive best-offer results in Phase 1. The schema may preserve other states, but they cannot silently win comparisons.

## Provider strategy

The first implementation uses a deterministic provider with stable fixtures. It implements the same capability contract as external providers and traverses the production ingestion, normalization, persistence, and query paths.

The deterministic provider is a contract reference, not a production substitute. Phase 1 also includes onboarding the first real PC provider after its access mechanism, permitted use, required authentication, regional coverage, rate limits, attribution requirements, and failure behavior have been verified. A provider that does not pass this gate is not enabled by default.

## Data flow

```text
Provider data
  -> boundary validation
  -> normalization
  -> canonical ProductVariant resolution
  -> regional eligibility evaluation
  -> current Offer persistence
  -> immutable PriceObservation append
  -> eligible-offer comparison
  -> explainable MCP response
```

Ingestion is idempotent for the same provider listing and source observation. Repeating a deterministic sync must not duplicate canonical identities or equivalent price observations.

## Pricing and regional rules

- Confirmed region incompatibility is a hard blocker.
- Unknown compatibility is never presented as confirmed compatibility.
- Original amount and currency are always preserved.
- Normalized amount, comparison currency, exchange-rate source, and conversion timestamp are stored separately.
- Currency conversion is a comparison aid and never claims that a retailer charges in the comparison currency.
- Phase 1 ranking uses the normalized final price when reliable inputs exist; otherwise it explicitly identifies missing shipping or tax information.
- A marketplace or lower-confidence source cannot be relabeled as an authorized retailer.

## Explainable offer selection

The best-offer use case first removes hard blockers and then ranks remaining offers using deterministic factors. Its response includes:

- selected offer and product variant;
- original and normalized price;
- region status;
- retailer class and source confidence;
- price-history context when available;
- positive factors;
- negative factors;
- blockers that excluded other offers;
- a stable public explanation.

Phase 1 does not implement the complete personalized Deal Score. It establishes the explainable selection contract that Deal Score v1 will extend.

## Initial public surfaces

The exact MCP names may be refined during the implementation plan, but Phase 1 covers these behaviors:

- search the canonical catalog;
- synchronize deterministic provider data;
- compare offers for a product variant;
- return the best eligible offer;
- read price history;
- create, list, update, and remove wishlist entries.

The CLI provides runtime startup commands needed by the MCP process and an initial `doctor` command. `doctor` verifies configuration validity, SQLite writability and migration state, deterministic-provider availability, and safe runtime prerequisites without printing secrets.

## Persistence

SQLite is the Phase 1 source of persistent application state. Migrations are ordered, checksummed, and applied transactionally. Opening an unsupported future schema version fails safely.

The initial persistence model covers:

- canonical catalog identities;
- provider listings and mapping state;
- current offers;
- immutable price observations;
- wishlist entries;
- migration metadata.

Tests use temporary real SQLite databases. They do not replace repository behavior with persistence mocks.

## Error handling

External and infrastructure errors are translated into stable public categories such as invalid configuration, provider unavailable, provider data invalid, ambiguous mapping, product not found, region incompatible, and persistence failure.

MCP and CLI output must not expose secrets, raw upstream payloads, stack traces, or private filesystem paths. Provider failures remain isolated and do not corrupt previously persisted valid data.

## Testing strategy

Development follows RED → GREEN → REFACTOR.

- **Unit tests:** canonical identity, normalization, regional eligibility, currency conversion, comparison rules, and wishlist behavior.
- **Provider contract tests:** deterministic provider capability metadata, schema validation, stable fixture behavior, and malformed-data rejection.
- **Persistence tests:** migrations, checksums, idempotent ingestion, transactions, price-history append behavior, and restart persistence.
- **Application tests:** end-to-end use cases across real domain and temporary SQLite adapters.
- **MCP integration tests:** tool discovery, input schemas, safe errors, deterministic synchronization, comparison, history, and wishlist flows.
- **CLI tests:** `doctor` success and bounded failure output.

## Phase boundary

### Included

- Project skeleton, configuration, safe errors, and developer tooling.
- SQLite migrations and repositories.
- Minimal canonical catalog.
- Provider capability contracts and deterministic provider.
- Normalized offers, regional rules, and currency normalization.
- Price history.
- Basic wishlist CRUD.
- Explainable offer comparison.
- Initial MCP tools.
- Initial CLI and `doctor`.
- The first real PC provider after its onboarding gate passes.

### Deferred without removing final scope

- Dashboard.
- Scheduler and workers.
- Alerts and notification transports.
- Budgets and purchase ledger.
- Subscription connectors.
- Console and physical-product providers.
- `steam-library-mcp` integration.
- Additional real providers.
- Full personalized Deal Score.

## Acceptance criteria

Phase 1 is complete when all of the following are demonstrated:

1. A clean installation succeeds with Node.js 22+, pnpm, and validated `CO`/`COP` defaults.
2. Migrations create and reopen a compatible SQLite database safely.
3. A deterministic sync creates canonical products, verified listings, offers, and immutable price observations without duplicate identities on replay.
4. An MCP client can search the catalog and retrieve an exact product variant.
5. An MCP client can compare offers and receive the best eligible offer with an explanation.
6. Region-incompatible and ambiguous-mapping offers cannot win.
7. Original and normalized currency data remain distinguishable.
8. Price history survives process restart.
9. Wishlist create, list, update, and remove operations persist across restart.
10. `doctor` reports healthy and bounded failure states without leaking secrets or local paths.
11. The first real provider passes its documented onboarding gate and uses the same application path as the deterministic provider.
12. Unit, provider-contract, persistence, application, MCP integration, and CLI tests pass.

## Relationship to the full product design

This phase implements the first dependency slice of `C:/Users/micha/Downloads/2026-08-30-gaming-deals-mcp-design.md`. It does not reduce the approved product scope. Its boundaries are intended to let later phases add dashboard, scheduling, alerts, budgets, subscriptions, platforms, physical products, and optional MCP-to-MCP integration without rewriting the core.
