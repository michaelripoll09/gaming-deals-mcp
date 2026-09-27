# Gaming Deals MCP — Architecture & Product Design

Date: 2026-08-30
Status: Approved architecture, final hardening complete, ready for implementation
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

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`
- TypeScript
- Model Context Protocol SDK
- SQLite
- React 19
- Vite
- Zod
- Vitest
- local loopback HTTP server bound to `127.0.0.1`

The goal is to reuse proven architectural patterns without coupling the two repositories.

The supported Node.js range is intentional rather than a generic `22+` promise. CI must continuously verify the minimum supported releases of the maintained even-numbered lines: Node.js `22.22.2`, `24.15.0`, and `26.0.0`. Odd-numbered Node.js release lines are not part of the supported runtime contract.

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

### 8.4 Product composition and entitlement granularity

Bundles and compilations must be represented explicitly rather than forced into the single-product hierarchy. A canonical product may declare zero or more composition records such as:

```text
ProductComposition
├── parentProductId
├── componentProductId
├── quantity
├── componentType          # base_game / dlc / add_on / soundtrack / virtual_currency / other
└── requiredForCompleteness
```

A bundle may therefore contain products from different releases or add-on relationships while still remaining a distinct purchasable Product. Bundle matching must validate component composition when provider metadata exposes it; a cheap bundle must not be treated as equivalent to a standalone edition unless its included rights are actually comparable.

Ownership/access is also platform- and product-scoped. Owning a PC/Steam product does not automatically imply ownership of the corresponding PlayStation, Xbox, or Nintendo product. Cross-platform equivalence may be used for discovery and recommendation context, but entitlement claims must preserve the exact product/platform/source that granted access.

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

### 9.4 Shared outbound-provider request policy

All networked provider adapters must use a common outbound-request policy or an equivalent shared utility so that cancellation, timeouts, retries, and error classification remain consistent across providers.

Required behavior:

- every request accepts an optional `AbortSignal`;
- caller cancellation propagates as cancellation and must not be converted into a provider-unavailable error;
- each request has a bounded timeout configurable per provider, with a conservative default;
- `429` responses respect `Retry-After` when valid;
- retryable network failures and selected `5xx` responses use bounded exponential backoff with jitter;
- authentication/authorization failures, validation errors, and ordinary non-retryable `4xx` responses are not blindly retried;
- the default maximum attempt count is finite and provider-overridable;
- retry sleeps are abortable so cancellation does not wait for the entire backoff period;
- response bodies are schema-validated before entering domain logic;
- provider errors are normalized into stable safe categories such as timeout, cancellation, rate-limited, authentication-required, malformed-upstream, and provider-unavailable.

Provider-specific terms and rate limits may tighten these defaults but must not weaken cancellation, secret-handling, or response-validation requirements.

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

### 10.1 Monetary representation and exchange-rate precision

Application/domain code must not represent money with binary floating-point values. Monetary amounts are stored and transported as integer minor units together with an ISO 4217 currency code.

Representative shape:

```text
MoneyAmount
├── amountMinor           # integer, e.g. 1999 for USD 19.99
└── currency              # ISO 4217 code
```

Currencies whose standard minor-unit exponent is not two must use their ISO-defined exponent. Currency metadata and formatting belong in a dedicated money/currency utility rather than being inferred ad hoc by providers.

Exchange rates are stored with explicit decimal precision sufficient for deterministic conversion and include:

- base currency;
- quote currency;
- rate value as decimal/string-safe representation;
- source/provider;
- observed timestamp;
- validity/freshness metadata.

Converted amounts must use one documented rounding rule at the money boundary and preserve the original amount/currency alongside the normalized comparison amount. Historical price comparisons must compare like-for-like normalized values using the conversion information recorded for each observation rather than silently revaluing old observations with today's rate.

## 11. Offer model

A normalized offer should support at least:

```text
ProductOffer
├── id
├── canonicalProductId
├── providerId
├── providerOfferId
├── sellerId?
├── retailerClass
├── acquisitionSourceType
├── condition              # digital/new/used as appropriate
├── fulfillmentType
├── priceOriginal          # MoneyAmount
├── priceNormalized        # MoneyAmount in comparison currency
├── listPriceOriginal?     # MoneyAmount / provider reference price
├── discountPercent?
├── shippingOriginal?      # MoneyAmount
├── shippingNormalized?    # MoneyAmount
├── taxesKnown?
├── finalPriceNormalized?  # MoneyAmount
├── regionCompatibility
├── drm?
├── stockState
├── lifecycle              # active/stale/expired/withdrawn
├── validFrom?
├── validUntil?
├── offerUrl
├── sourceConfidence
├── syncRunId
├── firstSeenAt
├── lastSeenAt
├── lastVerifiedAt
└── rawSourceReference?
```

`finalPriceNormalized` is preferred for ranking when reliable shipping/tax inputs are available. `discountPercent`, when present, must be derived from a documented provider/list-price reference and never fabricated from unrelated historical prices.

### 11.1 Offer identity, lifecycle, and synchronization

`providerId + providerOfferId` should form a stable upstream identity whenever the provider exposes one. When it does not, the adapter must derive a documented deterministic offer identity from stable provider fields and avoid volatile data such as current price in the identity key.

Each provider synchronization is represented by a `ProviderSyncRun` with at least an ID, provider, start/end timestamps, outcome, and counts for discovered/accepted/rejected offers. Offer reconciliation is tied to the sync run that observed the offer.

Lifecycle rules:

- `active`: observed in a successful authoritative sync and currently eligible for ranking;
- `stale`: last known valid offer whose freshness threshold has been exceeded; it may be shown with an explicit stale warning but cannot silently win a definitive best-price claim;
- `expired`: a known time-bounded offer has passed `validUntil`;
- `withdrawn`: a successful authoritative sync confirms that the offer disappeared or is no longer purchasable.

A failed or partial provider sync must never mass-expire or withdraw offers merely because they were not returned. Only a sync classified as sufficiently complete/authoritative for that provider may reconcile missing offers. Providers with paginated feeds must persist sync completeness before disappearance reconciliation is allowed.

Ranking/evaluation must re-check lifecycle, stock, freshness, and region compatibility before an offer can win. Old snapshots remain available to price history even after an offer leaves the active set.

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
├── amountOriginal        # MoneyAmount
├── amountNormalized      # MoneyAmount in primary comparison currency
├── exchangeRateRef?
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
├── priceOriginal         # MoneyAmount
├── priceNormalized       # MoneyAmount in comparison currency at observation time
├── exchangeRateRef?
├── listPriceOriginal?    # MoneyAmount
├── discountPercent?
├── stockState
├── offerLifecycle
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

### 22.3 Multi-process execution, leases, and idempotency

The runtime commands permit more than one process to interact with the same SQLite database, so task claiming must be safe across processes rather than relying only on an in-memory mutex.

A runnable task record should include or derive:

```text
TaskExecution
├── id
├── idempotencyKey?
├── state
├── workerId?
├── leaseAcquiredAt?
├── leaseExpiresAt?
├── heartbeatAt?
├── attempts
├── maxAttempts
└── nextAttemptAt?
```

Required semantics:

- claiming a queued/retryable task is an atomic SQLite transaction;
- only the worker that owns the active lease may report progress, complete, fail, or renew that execution;
- workers periodically heartbeat/renew leases for long-running tasks;
- an expired lease is reconciled on startup or by the scheduler and may be retried according to task policy;
- task handlers accept cooperative cancellation and check it before durable side effects;
- externally triggered work that can be requested repeatedly should support an idempotency key or equivalent uniqueness rule so duplicate enqueue requests do not create duplicate side effects;
- notification delivery and provider synchronization must be idempotent/replay-safe at their persistence boundary.

No SQLite transaction may remain open while a provider/network request is in flight. Claim/lease state is committed first, network work happens outside the transaction, and durable completion is written afterward with lease ownership revalidated.

### 22.4 Scheduler misfire semantics

Each recurring schedule declares a misfire policy. Supported policies should include:

- `skip`: ignore missed occurrences and resume at the next future schedule;
- `run_once`: coalesce one or more missed occurrences into one immediate execution;
- `catch_up_bounded`: replay a limited number of missed occurrences up to a configured cap.

Default recurring maintenance/provider schedules use `run_once` so a machine returning after downtime does not enqueue an unbounded backlog. A schedule's next-run calculation uses the installation's configured IANA time zone, while persisted execution timestamps remain UTC.

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

### 29.3 Configuration precedence and time semantics

Configuration precedence is explicit:

1. secrets and provider credentials come only from environment variables / `.env` or a future explicitly approved local secret store;
2. durable user preferences are stored in validated SQLite-backed settings;
3. supported CLI flags may override runtime behavior for that process invocation but do not persist unless an explicit persistence command/action says so;
4. compiled defaults apply only when no higher-precedence source supplies a value.

The installation stores an IANA time zone such as `America/Bogota` independently from its country/currency settings. All persisted timestamps are UTC ISO-8601 values. User-facing calendar boundaries—monthly/annual budget periods, scheduler expressions, daily alert windows, and similar concepts—are evaluated in the configured IANA time zone and then converted to UTC for persistence/execution.

Daylight-saving transitions must use time-zone-library semantics rather than manual UTC offsets. For an ambiguous/repeated local time, the scheduler must choose a deterministic occurrence and record the resulting UTC instant; for a nonexistent local time, the scheduler advances to the next valid local instant unless a schedule explicitly selects `skip`.

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

### 30.1 SQLite operational profile

Every application process opening the primary database must apply and verify a shared SQLite profile:

- `PRAGMA foreign_keys = ON`;
- WAL journal mode where supported by the target filesystem;
- a bounded `busy_timeout` (default 5000 ms unless testing requires another value);
- `synchronous = NORMAL` for the ordinary local runtime unless durability testing justifies a stricter mode;
- migrations executed serially with an exclusive migration lock/transaction so two starting processes cannot migrate concurrently;
- schema version/name/checksum recorded for every migration and newer unknown schema versions rejected safely.

Transaction boundaries must remain small and deterministic. Network requests, filesystem downloads, notification sends, and provider sleeps/backoff must happen outside database transactions. Multi-row state transitions that must be atomic—task claim, active-plan replacement, budget reservation/commit, alert-delivery deduplication, provider-sync reconciliation—must use explicit transactions.

Repository tests must exercise multiple database connections/process-like contenders for task claims and migration startup so concurrency correctness is not inferred solely from single-connection tests.

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

### 34.7 Continuous integration and security gate

CI is part of the architecture from the first implementation commit rather than a release-only cleanup task. The protected default branch should require these stable check contexts on pull requests:

- `format:check`;
- `lint`;
- `typecheck`;
- `tests`;
- `build`;
- `dependency audit`;
- `CodeQL (javascript-typescript)`;
- `dependency review`.

A separate Node compatibility matrix must run test/typecheck/build on Node.js `22.22.2`, `24.15.0`, and `26.0.0` without renaming the stable required check contexts above.

GitHub Actions should be pinned to immutable commit SHAs with version comments, checkout credentials should not persist unless explicitly required, and workflow permissions should follow least privilege. Dependabot should monitor both npm dependencies and GitHub Actions on a regular schedule.

Pull requests must not merge with required checks pending or failing. Dependency review may be pull-request-only; therefore a post-merge push can legitimately show that specific job as skipped while the other push-triggered checks still pass. Release verification must start from a clean checkout and must not rely on untracked local developer files.

## 35. Implementation sequencing

Although the product scope is designed fully now, implementation should be incremental to preserve quality.

Recommended dependency sequence:

1. project skeleton, config, errors, SQLite/migrations, protected-branch CI/security gates;
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
17. The stack remains Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, TypeScript, MCP SDK, SQLite, React/Vite, Zod, and Vitest.
18. Runtime architecture is a modular core with configurable composition.
19. Money uses integer minor units plus ISO 4217 currency identity; historical conversions preserve the rate context used at observation time.
20. Offers have stable provider identity, explicit lifecycle/freshness, and sync-run reconciliation semantics; failed/partial syncs cannot silently withdraw offers.
21. Multi-process task execution uses atomic claims, leases/heartbeats, cooperative cancellation, and idempotent persistence boundaries.
22. SQLite uses a shared WAL/foreign-key/busy-timeout profile, serialized migrations, and no network calls inside database transactions.
23. Bundles/product composition and platform-scoped entitlements are explicit domain concepts rather than fuzzy title equivalence.
24. All provider HTTP adapters follow a common cancellation/timeout/retry/rate-limit/error policy.
25. Durable user time semantics use a configured IANA time zone while persisted timestamps remain UTC.
26. CI/security checks and supported Node compatibility are release architecture, not optional repository hygiene.

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
- adding future providers does not require database coupling to existing external projects;
- money calculations are deterministic and never depend on binary floating-point currency math;
- a partial/failed provider sync cannot invalidate otherwise valid offers;
- two workers cannot execute the same leased task concurrently;
- task/notification/provider side effects remain idempotent across retry or crash recovery;
- bundle contents and platform-specific entitlements cannot be silently collapsed into a false ownership/equivalence claim;
- CI continuously verifies the protected branch against the supported Node.js compatibility matrix.

## 39. Public V1 release gate

Implementation may land incrementally, but the first public release labeled V1 is not considered complete until the cross-platform product promise is actually represented in working user-facing flows.

The V1 release gate requires:

- local installation and validated configuration;
- canonical catalog and persistent provider mappings;
- PC, PlayStation, Xbox, and Nintendo represented by at least one usable catalog/price/access path each, using automatic or documented import/manual fallback where automatic integration is unavailable;
- authorized-store and marketplace classes supported without conflation;
- digital and physical offer models operational, with at least one physical-provider path or documented import path;
- region compatibility and preferred-currency normalization using integer minor-unit money semantics and recorded exchange-rate context;
- price history and historical-low calculations for supported provider data;
- wishlist CRUD and synchronization/import hooks;
- ownership/access model including subscription access;
- flexible budgets and purchase ledger;
- explainable Deal Score with hard blockers and factor breakdown;
- persistent alerts with cooldown/deduplication;
- at least dashboard plus one external notification adapter, while retaining the modular channel interface;
- persistent task runner, scheduler, retries, cooperative cancellation, multi-process atomic claims/leases, idempotency, crash recovery, explicit misfire policy, and public task enqueue/list/get/cancel surfaces;
- MCP tools/resources/prompts for core deal workflows;
- React dashboard for deals, wishlist, budget, alerts, subscriptions, providers, and tasks;
- CLI including `doctor`;
- optional `steam-library-mcp` adapter that fails gracefully when absent;
- security controls described in this document;
- unit, persistence, MCP, dashboard/API, provider-contract, concurrency/multi-process, and release E2E coverage;
- release verification showing that secrets are not embedded in frontend artifacts or leaked through public errors;
- protected-branch CI/security gates green, including the supported Node.js compatibility matrix and dependency/security checks.

Where a platform or retailer does not expose a suitable public/documented integration, the release requirement is satisfied through an explicit import/manual connector only if the UI and MCP response clearly state the lower provenance/automation level. The product must never claim automatic synchronization that it cannot reliably perform.

## 40. Design review conclusion

The architecture intentionally separates stable product concepts from unstable external data sources. Catalog identity, offers, regional rules, budgets, alerts, tasks, recommendation logic, and persistence are owned by `gaming-deals-mcp`; storefronts, retailers, marketplaces, platform accounts, exchange rates, and notification services enter through adapters.

This boundary is the central long-term design decision. It allows the public self-hosted project to preserve its behavior even as individual providers change access policies, APIs, authentication requirements, or availability.

With monetary precision, offer lifecycle/reconciliation, multi-process task leasing, SQLite concurrency rules, explicit product composition/entitlement granularity, shared outbound-provider behavior, configuration/time semantics, and CI/security gates now specified, there are no remaining architectural blockers to begin implementation. Future refinements should be handled as implementation decisions unless they would violate one of the approved domain or safety boundaries above.

