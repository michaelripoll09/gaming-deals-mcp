# Gaming Deals MCP — Architecture & Product Design

Date: 2026-08-30
Status: Approved architecture, implementation not started
Project: `gaming-deals-mcp`

## 1. Product vision

`gaming-deals-mcp` is a local/self-hosted, multi-platform gaming purchase-intelligence system exposed through MCP, a local dashboard, a CLI, and a persistent scheduler.

It is not just a price scraper. Its purpose is to answer questions such as:

- What is the best game I can buy right now for my budget?
- Is this discount actually good compared with historical pricing?
- Do I already own this game, have access through a subscription, or have it in another library?
- Is the cheapest offer region-compatible and for the correct edition/platform?
- Should I buy now, wait, or skip?
- Is digital, physical new, or physical used the better value?
- Which wishlist items have reached a meaningful buying opportunity?
- Which games are leaving a subscription soon and may be worth buying?

The system must remain useful as a standalone project while supporting an optional MCP-to-MCP integration with `steam-library-mcp`.

## 2. Product principles

1. Local-first and self-hosted per user.
2. Multi-platform from the first release: PC, PlayStation, Xbox, and Nintendo.
3. Digital and physical products are first-class citizens.
4. Authorized retailers and marketplaces are both supported but never conflated.
5. Subscription access is temporary access, never ownership.
6. Region compatibility outranks raw price.
7. The system compares canonical products, not loose title strings.
8. Recommendations must be explainable.
9. Buying is always finalized manually by the user.
10. Providers are replaceable adapters; provider failure must not break the system.
11. Secrets stay local and are never exposed to the dashboard frontend.
12. The scheduler/task system is a public product capability, not hidden infrastructure.

## 3. Scope

### 3.1 Platforms

The initial product supports:

- PC
- PlayStation
- Xbox
- Nintendo

Platform-specific storefront identifiers and availability are normalized into the universal catalog.

### 3.2 Distribution modes

Supported product distributions:

- digital storefront purchase
- digital activation key/code
- physical new
- physical used
- subscription access

### 3.3 Retail source classes

Offers must classify their source as one of:

- `authorized_store`
- `marketplace`
- `first_party_storefront`
- `physical_retailer`

The UI and recommendation engine must preserve this classification. A marketplace offer must never be presented as equivalent in trust to an authorized store solely because it is cheaper.

### 3.4 Purchase boundary

The system may:

- compare offers;
- recommend an offer;
- expose a verified destination URL;
- open or direct the user to the selected product page.

The system must not:

- store payment-card details;
- place orders automatically;
- perform automatic checkout;
- store user storefront passwords;
- bypass storefront authentication controls.

## 4. Runtime model

The selected architecture is a modular core with configurable runtime composition.

Conceptually:

```text
                 +------------------+
                 |   MCP Adapter    |
                 +--------+---------+
                          |
                 +--------v---------+
                 |                  |
 Dashboard ----->|   Core Domain    |<----- CLI
                 |                  |
                 +--------+---------+
                          |
       +------------------+------------------+
       |                  |                  |
    Catalog             Deals          Intelligence
       |                  |                  |
   Providers          Price DB          Deal Score
       |                  |                  |
       +------------------+------------------+
                          |
                     Task Engine
                          |
                   Local Scheduler
                          |
                       SQLite
```

Internally the boundaries remain modular even when one process hosts multiple runtime roles.

### 4.1 Runtime commands

Target runtime composition:

```text
gaming-deals start
gaming-deals mcp
gaming-deals dashboard
gaming-deals worker
gaming-deals run <task>
```

`gaming-deals start` may compose the local API/dashboard, scheduler, and other runtime services suitable for interactive local use.

Separate commands allow advanced users to run independent processes or delegate periodic execution to cron / Windows Task Scheduler.

## 5. Technology stack

The project will intentionally align with `steam-library-mcp`:

- Node.js 22+
- TypeScript
- Model Context Protocol SDK
- SQLite
- React 19
- Vite
- Zod
- Vitest
- local loopback HTTP server bound to `127.0.0.1`

The goal is to reuse proven architectural patterns without coupling the two repositories.

## 6. Proposed repository structure

```text
src/
├── server/
│   ├── mcp-server.ts
│   └── registrations/
├── domain/
│   ├── catalog/
│   ├── offers/
│   ├── wishlist/
│   ├── library/
│   ├── subscriptions/
│   ├── budgets/
│   ├── recommendations/
│   ├── alerts/
│   └── tasks/
├── providers/
│   ├── authorized/
│   ├── marketplaces/
│   ├── storefronts/
│   ├── physical/
│   ├── exchange-rates/
│   └── metadata/
├── integrations/
│   ├── steam/
│   ├── xbox/
│   ├── playstation/
│   ├── nintendo/
│   └── mcp/
│       └── steam-library/
├── catalog/
├── pricing/
├── intelligence/
├── notifications/
├── scheduler/
├── persistence/
│   └── sqlite/
├── dashboard/
├── cli/
├── config/
└── core-services.ts
```

The exact file layout may evolve, but the domain boundaries are architectural requirements.

## 7. Core dependency rule

Providers do not communicate directly with the MCP layer, dashboard, or UI.

The dependency direction is:

```text
MCP / Dashboard / CLI
        |
        v
Application services
        |
        v
Domain contracts
        |
        v
Provider / persistence adapters
```

This keeps provider churn isolated from user-facing contracts and business logic.

## 8. Universal canonical catalog

Title-only fuzzy matching is insufficient and may confuse remakes, DLC, bundles, editions, and platforms.

The canonical hierarchy is:

```text
Game
└── Release
    ├── Edition
    │   └── Product
    │       ├── Platform
    │       ├── Distribution
    │       ├── Region constraints
    │       └── Provider mappings
    └── Add-on / DLC relationships
```

### 8.1 Entity definitions

#### Game
The conceptual franchise title/work.

#### Release
A specific released work or version, e.g. a remake distinct from the original release.

#### Edition
A commercial edition such as Standard, Deluxe, Gold, Ultimate, Collector's, etc.

#### Product
The exact purchasable/access unit after platform/distribution/edition context is applied.

Examples:

- Resident Evil 4 (2023) / Gold Edition / PS5 / digital
- Resident Evil 4 (2023) / Standard / Steam / digital key
- Resident Evil 4 (2023) / Standard / PS5 / physical used

### 8.2 Provider mappings

Each external provider product is mapped to a canonical Product using a persistent mapping.

Mapping states:

- `verified`
- `probable`
- `ambiguous`
- `unmatched`

Only verified mappings, and optionally sufficiently trusted probable mappings under explicit rules, may participate in definitive "best price" claims.

Ambiguous products must not silently win price comparisons.

### 8.3 Matching workflow

1. Provider item discovery.
2. Normalize name, platform, edition, identifiers, release context, and product metadata.
3. Match by strong identifiers when available.
4. Use names only to generate candidate matches.
5. Score candidates.
6. Persist verified mapping.
7. Surface ambiguous matches for review rather than silently guessing.

## 9. Provider architecture

Providers declare capabilities rather than conforming to one overly broad interface.

Representative contracts:

```text
DealProvider
CatalogProvider
LibraryProvider
WishlistProvider
SubscriptionProvider
CurrencyProvider
PhysicalStockProvider
NotificationProvider
```

Each provider exposes metadata such as:

- provider ID
- source category
- platforms supported
- capabilities
- authentication requirements
- confidence level
- health state
- last successful sync
- rate-limit metadata
- data freshness

### 9.1 Data-source confidence

Upstream acquisition mechanisms are tracked separately from retailer class.

Possible acquisition types:

- `official_api`
- `partner_api`
- `public_feed`
- `public_page`
- `manual_provider`

Each normalized offer includes source provenance and freshness metadata.

### 9.2 Scraping policy

The architecture may support public-page adapters only where access is technically and legally reasonable.

The product must not depend on automated login scraping, stored storefront passwords, captcha bypass, or similar fragile authentication workarounds.

Provider adapters must be individually disableable.

### 9.3 Initial provider strategy and access gates

Provider selection is deliberately treated as a deployment capability rather than a hardcoded assumption. External API terms and access rules can change, so every integration must pass an onboarding gate before becoming a default provider.

The initial provider strategy is:

- **PC authorized-store aggregation:** prefer a documented aggregation API or approved affiliate/catalog feed. IsThereAnyDeal is technically capable of returning country-aware prices, historical lows, shops, bundles, and webhooks, but its current API terms also prohibit apps that could be considered competition. Therefore ITAD must be treated as **permission-gated**, not as an architectural dependency. It may only be enabled when the project's use complies with its current terms or explicit approval has been obtained.
- **Direct authorized retailers:** prioritize retailer/affiliate catalog feeds where an approved integration exists. Green Man Gaming currently advertises access to its full product catalog API through its business affiliate program, making this class of integration a valid target after provider enrollment.
- **Authorized-store fallback:** CheapShark is a candidate PC source because it publicly supports third-party applications and states that it tracks official distributors. It still requires a provider-specific technical/terms review before becoming a default dependency.
- **Marketplaces:** do not assume that a public read API exists merely because a marketplace has developer documentation. Current Eneba API access is merchant-oriented, and Kinguin's documented API is focused on sellers. These providers therefore remain **access-gated adapters** unless a consumer-price feed or explicitly permitted public-page integration is available.
- **Console first-party storefronts:** treat public price discovery separately from publisher/service entitlement APIs. Microsoft documents Store service APIs, but several entitlement/product flows are publisher/service oriented and authorization-gated. PlayStation and Nintendo integrations must likewise pass the same documented-access review rather than relying on private endpoints.
- **Physical retail:** onboard retailer APIs, affiliate product feeds, or approved public-page adapters individually. Shipping, tax, stock, condition, seller identity, and regional fulfillment must be represented explicitly.

Before enabling a provider by default, the implementation must record:

1. access mechanism;
2. authentication model;
3. permitted use for a public self-hosted project;
4. rate limits/polling expectations;
5. supported countries/platforms;
6. data fields available;
7. attribution/affiliate requirements;
8. whether automated price comparison is explicitly permitted;
9. fallback behavior when the source is unavailable.

A provider that fails this gate may still exist as an optional experimental adapter, but it must be disabled by default and clearly labeled.

## 10. Regional compatibility and currency

Each installation has:

- a primary country;
- a preferred display/comparison currency.

Offers preserve:

- original numeric price;
- original currency;
- converted comparison price;
- region/activation restrictions;
- conversion timestamp/source.

Currency conversion is a comparison aid, not a representation that the retailer charges in the converted currency.

An offer known to be incompatible with the user's region is ineligible to win a recommendation.

Unknown compatibility lowers confidence and must be surfaced rather than assumed safe.

## 11. Offer model

A normalized offer should support at least:

```text
ProductOffer
├── id
├── canonicalProductId
├── providerId
├── sellerId?
├── retailerClass
├── acquisitionSourceType
├── condition              # digital/new/used as appropriate
├── fulfillmentType
├── priceOriginal
├── currencyOriginal
├── priceNormalized
├── currencyNormalized
├── shippingOriginal?
├── shippingNormalized?
├── taxesKnown?
├── finalPriceNormalized?
├── regionCompatibility
├── drm?
├── stockState
├── offerUrl
├── sourceConfidence
├── firstSeenAt
├── lastSeenAt
├── lastVerifiedAt
└── rawSourceReference?
```

`finalPriceNormalized` is preferred for ranking when reliable shipping/tax inputs are available.

## 12. Physical products

Physical offers are first-class and may include:

- new / used condition;
- shipping cost;
- stock state;
- platform compatibility;
- edition;
- region;
- delivery or pickup information when provided;
- retailer/seller distinction.

Used inventory must never be conflated with new inventory.

Comparisons should rank by estimated final acquisition cost where reliable.

## 13. Library and access model

A user's relationship with a game/product is normalized independently of provider-specific source data.

Access states include:

- `owned`
- `subscription_access`
- `wishlist`
- `no_access`

Ownership and subscription access are distinct.

### 13.1 Source provenance

Library/access records preserve origin:

- synced
- imported
- manual
- MCP integration
- subscription connector

The system must never pretend a manually imported record has the same verification level as a strongly authenticated/synchronized source.

## 14. Subscription access

Subscription integrations may include services such as:

- Xbox Game Pass / PC Game Pass
- PlayStation Plus tiers
- Nintendo Switch Online catalog features where applicable
- EA Play
- Ubisoft+
- additional supported services

Subscription access is temporary.

Where reliable metadata exists, preserve:

- date added;
- announced leave date;
- service/tier;
- platforms;
- region.

The recommendation engine may discourage buying a game already accessible by subscription while raising urgency when the game is leaving soon and the user wants permanent ownership.

## 15. Wishlist

Wishlist entries are richer than a product ID.

Representative model:

```text
WishlistEntry
├── game/release/product target
├── preferredPlatforms[]
├── preferredEdition?
├── priority
├── targetPrice?
├── maximumPrice?
├── physicalPreference
├── conditionPreference
├── preferredStores[]
├── excludedStores[]
├── notes?
├── createdAt
└── updatedAt
```

Wishlist entries may be synchronized from supported platform connectors while preserving local user-specific preferences.

## 16. Budgeting

The budget system is flexible but optional.

Core concepts:

- monthly limit;
- annual limit;
- optional rollover;
- optional per-platform limits;
- optional category limits;
- reserved purchases;
- recorded purchases;
- excluded/exception purchases;
- primary currency.

Budget is a recommendation factor, not a hard global purchase prohibition unless a user explicitly configures a hard rule.

### 16.1 Purchase ledger

Representative purchase record:

```text
Purchase
├── canonicalProductId
├── providerId
├── platform
├── amountOriginal
├── currencyOriginal
├── amountNormalized
├── purchasedAt
├── excludedFromBudget
└── notes?
```

The product may later use the purchase ledger for spending analytics and recommendation calibration.

## 17. Price history

Price observations are persisted locally.

Representative record:

```text
PriceObservation
├── canonicalProductId
├── providerId
├── offerIdentity
├── priceOriginal
├── currencyOriginal
├── priceNormalized
├── stockState
└── observedAt
```

To avoid unbounded useless growth, identical polling snapshots should not be inserted indefinitely. The persistence layer should store changes/events or apply an equivalent deduplication/compaction strategy.

Historical analysis may calculate:

- all-time low;
- recent low;
- typical discounted price;
- discount frequency;
- time since last comparable price;
- volatility;
- provider-specific lows.

No predictive "future price" claim should be presented as certain.

## 18. Explainable Deal Score

The recommendation engine returns a score and a structured explanation.

Possible factors include:

- normalized final price;
- distance from historical low;
- discount quality;
- store/marketplace trust class;
- provider confidence/freshness;
- correct platform/edition fit;
- regional compatibility;
- already owned;
- subscription access;
- wishlist priority;
- user target price;
- remaining budget;
- preferred distribution;
- preferred platform;
- physical/digital preference;
- new/used preference;
- backlog state;
- expected user interest;
- ratings/quality signals where available;
- duration/value signals where appropriate;
- DRM preferences;
- co-op/friends requirements where relevant.

### 18.1 Explainability requirement

The score must be decomposable into factor contributions.

Example shape:

```text
DealScoreResult
├── score: 0..100
├── verdict
├── positiveFactors[]
├── negativeFactors[]
├── blockers[]
└── explanation
```

Example verdicts:

- `exceptional_buy`
- `buy`
- `good_deal`
- `neutral`
- `wait`
- `skip`

Exact default thresholds may be tuned during implementation but must remain configurable/testable rather than buried in UI code.

### 18.2 Hard blockers vs soft score factors

Some facts should block an offer before scoring, for example:

- confirmed region incompatibility;
- wrong platform/product mapping;
- out of stock when immediate purchase is required;
- known invalid/dead offer.

Other facts influence ranking instead of blocking, for example:

- marketplace vs authorized retailer;
- budget pressure;
- historical low distance;
- wishlist priority.

## 19. Recommendation flows

### 19.1 Best offer for a known product

```text
Query
 -> canonical product resolution
 -> candidate offer aggregation
 -> region filtering
 -> product/edition/platform validation
 -> currency normalization
 -> final-price calculation
 -> history enrichment
 -> access/library enrichment
 -> budget enrichment
 -> Deal Score
 -> explainable ranked result
```

### 19.2 What should I buy?

```text
User constraints
 -> candidate catalog/wishlist/deal discovery
 -> remove owned/ineligible products
 -> subscription-access awareness
 -> budget constraints
 -> offer availability
 -> preference matching
 -> Deal Score
 -> ranked recommendations
```

## 20. Alerts

Alert rules are persisted locally.

Supported rule categories should include:

- target price reached;
- new historical low;
- discount percentage reached;
- product back in stock;
- wishlist deal detected;
- Deal Score threshold reached;
- subscription added;
- subscription leaving soon;
- preferred physical condition available;
- preferred authorized-store price reached.

Representative model:

```text
AlertRule
├── id
├── target
├── condition
├── enabled
├── channels[]
├── cooldown
├── createdAt
└── updatedAt
```

Alerts need cooldown/deduplication semantics so unchanged offers do not repeatedly spam users.

## 21. Notification architecture

Domain logic emits notification-worthy events without depending on a transport.

Example events:

- `PRICE_TARGET_REACHED`
- `HISTORICAL_LOW_REACHED`
- `WISHLIST_DEAL_FOUND`
- `SUBSCRIPTION_LEAVING_SOON`
- `PHYSICAL_STOCK_AVAILABLE`

A dispatcher sends notifications through configured channels.

Target adapters:

- dashboard inbox
- Discord webhook
- Telegram
- email
- local OS notifications

Notification transports are optional plugins/adapters and may fail independently.

## 22. Task runner and scheduler

The task engine is persistent and publicly exposed through MCP/API/CLI.

Initial task types:

- `sync_prices`
- `sync_wishlist`
- `sync_library`
- `sync_subscriptions`
- `sync_physical_stock`
- `sync_exchange_rates`
- `refresh_catalog`
- `evaluate_alerts`
- `calculate_deal_scores`
- `send_notifications`
- `cleanup_price_history`

Task states:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

Task metadata includes:

- attempts;
- maximum attempts;
- retry/backoff timing;
- progress;
- cancellation request/state;
- safe error code/message;
- created/started/finished timestamps.

### 22.1 Scheduler

The scheduler is configurable per installation.

Representative defaults may include:

- priority alert checks: frequent;
- wishlist refresh: every few hours;
- broader pricing refresh: several times per day;
- exchange rates/catalog maintenance: daily or provider-appropriate.

Exact provider polling cadence must honor source terms and rate limits.

### 22.2 Crash recovery

Tasks left in `running` state after an unexpected process exit must be reconciled safely on startup rather than remaining permanently stuck.

## 23. Optional `steam-library-mcp` integration

`gaming-deals-mcp` remains fully functional without `steam-library-mcp`.

When configured, it uses an MCP client adapter to communicate through public MCP contracts instead of reading the other project's SQLite database.

Potential data consumed:

- Steam library;
- backlog/current/completed status;
- recommendation preferences;
- active backlog plans.

Integration behavior:

- failure or absence does not prevent startup;
- data provenance records that information came from the MCP integration;
- no shared persistence;
- no cross-project migration dependency.

When unavailable, normal Steam/platform connectors provide standalone functionality where possible.

## 24. Platform connectors

The system uses a hybrid connector model.

Preferred order:

1. documented/authorized platform integration when available;
2. safe public APIs/feeds where appropriate;
3. imports;
4. manual fallback.

The product must not require unofficial password storage to be useful.

Each connector should report its sync quality/provenance so the system can distinguish strongly verified ownership from manual/imported data.

## 25. MCP surface

The initial public tool families should include the following concepts.

### Deals

- `deal_search`
- `deal_get_best_offer`
- `deal_compare_product`
- `deal_get_price_history`
- `deal_get_recommendations`

### Wishlist

- `wishlist_list`
- `wishlist_add`
- `wishlist_update`
- `wishlist_remove`

### Alerts

- `alert_list`
- `alert_create`
- `alert_update`
- `alert_delete`

### Budget

- `budget_get`
- `budget_update`
- `budget_get_status`

### Purchases

- `purchase_record`
- `purchase_list`

### Library / access

- `library_get`
- `library_sync`
- `subscription_list`
- `subscription_sync`

### Catalog

- `catalog_search`
- `catalog_get_game`

### Tasks

- `task_enqueue`
- `task_list`
- `task_get`
- `task_cancel`

Tool names may be refined for MCP ergonomics, but public task creation is a requirement.

## 26. MCP resources and prompts

Candidate resources:

- `gaming-deals://wishlist`
- `gaming-deals://alerts`
- `gaming-deals://budget`
- `gaming-deals://best-deals`
- `gaming-deals://subscriptions`
- `gaming-deals://tasks`
- `gaming-deals://provider-health`

Candidate prompts:

- `what-should-i-buy`
- `best-deals`
- `wishlist-review`
- `monthly-budget-review`
- `platform-deals`
- `backlog-vs-buy`

Prompts should orchestrate tools rather than duplicate business logic in prompt text.

## 27. Dashboard

The dashboard is a local-first React/Vite application served only over the loopback interface.

Primary areas:

- Discover
- Deals
- Wishlist
- Library
- Price History
- Subscriptions
- Budget
- Alerts
- Purchases
- Providers
- Tasks
- Settings

### 27.1 Home dashboard

The home view should surface:

- remaining budget;
- top personalized deals;
- wishlist deal count;
- reached alerts;
- subscription changes;
- provider health warnings;
- active/recent tasks.

### 27.2 Product detail view

A product page should show:

- canonical release/edition/platform;
- offer comparison;
- authorized-vs-marketplace grouping;
- digital-vs-physical grouping;
- current and historical pricing;
- region/DRM information;
- source confidence/freshness;
- access status;
- wishlist state;
- Deal Score explanation;
- safe link to the chosen storefront/retailer.

## 28. CLI

Target commands:

```text
gaming-deals start
gaming-deals mcp
gaming-deals dashboard
gaming-deals worker
gaming-deals sync
gaming-deals deals
gaming-deals wishlist
gaming-deals alerts
gaming-deals providers
gaming-deals tasks
gaming-deals doctor
gaming-deals run <task>
```

`doctor` checks runtime health without exposing secrets.

Example checks:

- SQLite writable;
- configuration valid;
- provider credentials present where required;
- provider health;
- exchange-rate source health;
- optional notification channel status;
- optional `steam-library-mcp` integration health.

## 29. Configuration

Use two classes of configuration.

### 29.1 Secrets

Stored in environment variables / `.env` and never returned to the frontend.

Examples:

```text
STEAM_API_KEY
ITAD_API_KEY
TELEGRAM_BOT_TOKEN
...provider-specific secrets
```

### 29.2 User preferences

Stored as validated local configuration and/or SQLite-backed settings managed by the dashboard.

Examples:

```json
{
  "country": "CO",
  "currency": "COP",
  "platforms": ["pc", "ps5", "xbox-series", "switch"],
  "budget": {
    "monthly": 200000
  }
}
```

No secrets belong in browser bundles or frontend-accessible preference payloads.

## 30. Persistence

SQLite is the single local source of persistent application state for the initial architecture.

Expected data contexts include:

- canonical catalog;
- provider mappings;
- normalized offers;
- price history;
- wishlist;
- library/access state;
- subscriptions;
- budgets;
- purchase ledger;
- alerts;
- notification delivery state;
- tasks;
- provider health/sync metadata;
- local settings.

A migration system with checksums should be used to detect drift and unsupported future database versions.

Migration failure must fail safely without leaking secrets or database contents.

## 31. Security requirements

The local dashboard/API must preserve strong local security boundaries.

Required controls:

- bind to `127.0.0.1` by default;
- reject unexpected Host headers;
- same-origin validation for mutations;
- Content Security Policy;
- clickjacking protection;
- `nosniff`;
- conservative referrer policy;
- bounded request-body sizes;
- strict content-type checks;
- schema validation at boundaries;
- path traversal protection for static assets;
- safe external URL validation;
- secrets never serialized to the UI;
- sanitized error envelopes;
- no storefront passwords;
- no payment-card storage;
- no automatic checkout.

## 32. Error model

Errors should be typed and mapped into stable safe public error codes.

Representative categories:

- configuration failure;
- provider unavailable;
- provider authentication required;
- rate limited;
- stale provider data;
- ambiguous product match;
- product not found;
- region incompatible;
- persistence failure;
- task failure;
- notification delivery failure;
- optional integration unavailable.

Raw upstream responses, secrets, local file paths, and stack traces must not be exposed through MCP/dashboard contracts.

## 33. Observability and provider health

Because this is local/self-hosted, observability should remain lightweight.

Track locally:

- last successful provider sync;
- last failure and safe failure code;
- average/recent latency where useful;
- rate-limit status;
- number of offers synchronized;
- task history;
- notification delivery state.

The dashboard and `doctor` command expose safe health summaries.

## 34. Testing strategy

Testing should mirror the modular architecture.

### 34.1 Unit tests

Cover:

- catalog matching;
- edition/platform normalization;
- region compatibility;
- currency normalization;
- final-price calculation;
- Deal Score factors;
- budget calculations;
- alert conditions;
- task transitions/backoff;
- provider capability decisions.

### 34.2 Provider contract tests

Each provider adapter is tested against recorded/fixture responses and a common behavior contract.

Tests must verify that malformed external data does not enter the domain unchecked.

### 34.3 Persistence tests

Cover migrations, checksums, future migration versions, transactions, deduplication, task recovery, and state persistence across process restarts.

### 34.4 MCP integration tests

Verify:

- tool discovery;
- schemas;
- safe errors;
- read/write annotations where appropriate;
- no secret leakage;
- optional Steam MCP integration failure behavior.

### 34.5 Dashboard/API tests

Verify:

- local bind restrictions;
- Host/Origin checks;
- static SPA serving;
- API routes;
- mutation validation;
- frontend secret isolation;
- main user journeys.

### 34.6 Release E2E

A release test should build server + dashboard and exercise a representative clean installation using deterministic fake providers, including process restart and database persistence.

## 35. Implementation sequencing

Although the product scope is designed fully now, implementation should be incremental to preserve quality.

Recommended dependency sequence:

1. project skeleton, config, errors, SQLite/migrations;
2. canonical catalog domain;
3. provider capability framework;
4. one deterministic catalog/deal provider path;
5. normalized offers + currency/region logic;
6. price history;
7. wishlist/library/access;
8. Deal Score v1;
9. MCP deal/wishlist surface;
10. dashboard foundation;
11. scheduler/task runner;
12. alerts and notification dispatcher;
13. budgeting/purchase ledger;
14. subscription model/connectors;
15. additional PC providers;
16. PlayStation/Xbox/Nintendo providers;
17. physical-new/used providers;
18. optional `steam-library-mcp` adapter;
19. recommendation refinement;
20. provider health/doctor/release hardening.

This is sequencing, not scope reduction. The architectural contracts should prevent later modules from requiring a rewrite of the core.

## 36. Explicit non-goals

The initial architecture does not include:

- centralized SaaS accounts;
- a shared cloud database;
- automatic checkout;
- payment storage;
- storefront password storage;
- guaranteed support for every retailer;
- guaranteed future-price prediction;
- bypassing geographic restrictions;
- presenting grey-market/marketplace offers as authorized retail.

## 37. Key architectural decisions approved

The design records the following approved choices:

1. Authorized stores and marketplaces are both supported and clearly separated.
2. The project is independently useful with optional `steam-library-mcp` integration.
3. It is local/self-hosted per user rather than a centralized SaaS.
4. Region is primary; currency conversion is supported for comparison.
5. PC, PlayStation, Xbox, and Nintendo are in product scope from the first release.
6. Both digital and physical offers are supported.
7. Subscription access is modeled as temporary access rather than ownership.
8. Platform/library synchronization uses a hybrid connector approach with manual/import fallback.
9. Notifications use a modular event/adapter architecture.
10. Provider integrations use explicit source confidence and capability metadata.
11. A canonical universal catalog performs strict product/edition/platform matching.
12. The recommendation engine uses an explainable personalized Deal Score.
13. A persistent public task runner and local scheduler power recurring work.
14. The system can prepare/direct the user to a purchase but never completes checkout.
15. Budgeting is intelligent, flexible, optional, and explainable.
16. `steam-library-mcp` integration is MCP-to-MCP and never shares databases.
17. The stack remains Node.js 22+, TypeScript, MCP SDK, SQLite, React/Vite, Zod, and Vitest.
18. Runtime architecture is a modular core with configurable composition.

## 38. Definition of architectural success

The architecture is successful if all of the following remain true during implementation:

- adding/replacing a retailer does not require changes to recommendation/UI business logic;
- platform-specific IDs never become the canonical domain identity;
- ambiguous editions cannot silently win a cheapest-price comparison;
- a provider outage degrades functionality rather than crashing the product;
- the user can understand why a purchase is recommended;
- the system can run entirely locally;
- all automated background behavior is inspectable/cancellable through public surfaces;
- `steam-library-mcp` can be absent without breaking Gaming Deals;
- secrets remain server-side/local;
- adding future providers does not require database coupling to existing external projects.

## 39. Public V1 release gate

Implementation may land incrementally, but the first public release labeled V1 is not considered complete until the cross-platform product promise is actually represented in working user-facing flows.

The V1 release gate requires:

- local installation and validated configuration;
- canonical catalog and persistent provider mappings;
- PC, PlayStation, Xbox, and Nintendo represented by at least one usable catalog/price/access path each, using automatic or documented import/manual fallback where automatic integration is unavailable;
- authorized-store and marketplace classes supported without conflation;
- digital and physical offer models operational, with at least one physical-provider path or documented import path;
- region compatibility and preferred-currency normalization;
- price history and historical-low calculations for supported provider data;
- wishlist CRUD and synchronization/import hooks;
- ownership/access model including subscription access;
- flexible budgets and purchase ledger;
- explainable Deal Score with hard blockers and factor breakdown;
- persistent alerts with cooldown/deduplication;
- at least dashboard plus one external notification adapter, while retaining the modular channel interface;
- persistent task runner, scheduler, retries, cancellation, crash recovery, and public task enqueue/list/get/cancel surfaces;
- MCP tools/resources/prompts for core deal workflows;
- React dashboard for deals, wishlist, budget, alerts, subscriptions, providers, and tasks;
- CLI including `doctor`;
- optional `steam-library-mcp` adapter that fails gracefully when absent;
- security controls described in this document;
- unit, persistence, MCP, dashboard/API, provider-contract, and release E2E coverage;
- release verification showing that secrets are not embedded in frontend artifacts or leaked through public errors.

Where a platform or retailer does not expose a suitable public/documented integration, the release requirement is satisfied through an explicit import/manual connector only if the UI and MCP response clearly state the lower provenance/automation level. The product must never claim automatic synchronization that it cannot reliably perform.

## 40. Design review conclusion

The architecture intentionally separates stable product concepts from unstable external data sources. Catalog identity, offers, regional rules, budgets, alerts, tasks, recommendation logic, and persistence are owned by `gaming-deals-mcp`; storefronts, retailers, marketplaces, platform accounts, exchange rates, and notification services enter through adapters.

This boundary is the central long-term design decision. It allows the public self-hosted project to preserve its behavior even as individual providers change access policies, APIs, authentication requirements, or availability.
