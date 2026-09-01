# Phase 2: Local Access and Wishlist Recommendations Design

Phase 2 adds a **local access model** and an explainable `what_should_i_buy` recommendation flow. It lets an MCP client record whether a canonical product variant is owned, temporarily accessible through a subscription, or borrowed; then ranks only wishlist products that remain purchasable. The phase deliberately keeps access separate from wishlist intent, so future library or subscription connectors can use the same model without changing recommendation policy.

## Outcome

A local MCP user can manage manual access records for canonical product variants and ask `what_should_i_buy` for a deterministic, scored, explainable ranking of eligible wishlist products. An owned product is never recommended for purchase. A currently active subscription or loan remains purchasable but receives a large, visible penalty rather than being silently removed.

## Scope and non-goals

### Included

- A dedicated `access` module, independent of the `wishlist` module.
- Manual access CRUD through strict MCP tools.
- Domain types and repository ports for access records linked to canonical `ProductVariant` identities.
- SQLite migrations and repositories for access persistence.
- `what_should_i_buy`, backed only by persisted wishlist products and their eligible offers.
- Deal Score v1 as an injected, deterministic, testable application policy.
- Structured score contributions, blockers, and stable human-readable explanations.
- Unit, persistence, application, and MCP integration coverage.

### Explicit non-goals

Phase 2 does **not** add a dashboard, scheduler/workers, alerts/transports, budgets, a purchase ledger, subscription connectors, Steam integration, additional deal providers or platforms, physical products, or score-weight customization. The MCP client cannot configure policy weights or verdict thresholds.

## Relationship to Phase 1 and the full product design

Phase 1 already owns canonical catalog identity, verified provider mappings, regional eligibility, current offers, price history, wishlist CRUD, safe errors, and SQLite migration conventions. Phase 2 composes those capabilities; it does not create a parallel catalog, offer, or wishlist path.

This is the next dependency slice of the full design at `C:/Users/micha/Downloads/2026-08-30-gaming-deals-mcp-design.md`, especially its access model (section 13), explainable Deal Score and blocker distinction (section 18), recommendation flow (section 19), MCP surface (section 25), persistence rules (section 30), error model (section 32), testing strategy (section 34), and sequencing (section 35). It implements a narrow local-access and recommendation foundation while preserving the full product design's later connector, budget, and alert capabilities.

## Architecture and boundaries

```text
MCP tools
  -> application services
     -> catalog / wishlist / offer / access repository ports
     -> DealScorePolicy port
  -> SQLite adapters

Future authenticated library or subscription connectors
  -> connector adapter
  -> access application service / AccessRepository
```

| Boundary | Responsibility | Must not own |
|---|---|---|
| `wishlist` | A user's purchase intent, priority, optional target price, and notes. | Ownership, subscriptions, or loans. |
| `access` | A user's relationship to one canonical product variant and its provenance/effective period. | Wishlist priority, budget, purchases, or provider-specific identity. |
| `pricing` / existing offer comparison | Verified-mapping, region, availability, and reliable-final-price eligibility; selection of the best eligible offer for one product variant. | Personalized ranking. |
| recommendation application service | Loads wishlist candidates, access state, and eligible offers; invokes scoring policy; returns a ranked explanation. | SQLite, MCP SDK, provider parsing, or score constants. |
| `DealScorePolicy` | Applies the documented v1 policy to normalized candidate facts. | MCP schemas, mutable user settings, persistence, or fetching data. |
| MCP adapter | Strict validation, annotations, and safe result/error envelopes. | Business-policy decisions or direct SQL. |
| SQLite adapter | Migration execution and port implementations. | Score calculations or public MCP semantics. |

The composition root injects repositories, a clock, and the v1 policy into the recommendation service. The policy therefore remains directly unit-testable and can be replaced in a later phase without making it user-configurable.

## Local access model

An access record represents one independently sourced claim that a user can access a canonical `ProductVariant`.

| Field | Meaning |
|---|---|
| `id` | UUID access-record identity. |
| `productVariantId` | Required UUID reference to the canonical `ProductVariant`; provider listings are never referenced directly. |
| `state` | One of `owned`, `subscription_access`, or `loan`. |
| `provenance` | `manual` in Phase 2. The field remains explicit so later connectors can map their source into the same model. |
| `activeFrom` | Optional ISO-8601 instant at which access starts. A missing value means effective immediately. |
| `activeUntil` | Optional ISO-8601 instant at which access ends. A missing value means no known end. |
| `createdAt`, `updatedAt` | Auditable record timestamps. |

A record is **active** at the recommendation evaluation time when `activeFrom` is absent or not later than that time, and `activeUntil` is absent or later than that time. The end instant is exclusive. This makes an expired loan or subscription record non-active without deleting historical local state.

Multiple access records may reference the same product variant because access claims can have different provenance or effective periods. Phase 2 accepts only `manual` provenance, but future connectors must create or update records through the access boundary rather than adding connector-specific ownership fields elsewhere.

### Derived purchase status

For a product variant at evaluation time:

1. If **any active `owned`** record exists, the product is purchase-blocked.
2. Otherwise, if one or more active `subscription_access` or `loan` records exist, the product remains eligible and receives the access penalty once.
3. Otherwise, the product has no active access penalty.

This ordering is intentional: ownership is stronger evidence than temporary access. A temporary-access penalty is not multiplied when both a loan and subscription record are active.

## Data model and persistence

Phase 2 adds an `access_records` persistence model with the fields above and a foreign key to the existing canonical product-variant table. It must include indexes that support lookup by `product_variant_id` and evaluation of active records without scanning unrelated access data. The migration retains the Phase 1 ordered, checksummed, transactional migration protocol; opening a database with an unsupported future version continues to fail safely.

New application ports are intentionally narrow:

- `AccessRepository.create(record)`
- `AccessRepository.list(filter?)`
- `AccessRepository.update(record)`
- `AccessRepository.remove(accessRecordId)`
- `AccessRepository.listByProductVariantIds(productVariantIds)`

`listByProductVariantIds` avoids one repository query per wishlist candidate. The recommendation service receives only normalized domain records; it does not know SQL table names or migration details.

An access mutation validates that the referenced `ProductVariant` exists before it is persisted. Foreign-key enforcement remains a persistence backstop, not the public validation contract. Create/update/remove behavior follows the existing wishlist persistence and transaction conventions, including process-restart persistence.

## Deal Score v1 policy

### Candidate eligibility

`what_should_i_buy` considers **only persisted wishlist entries**. For each entry it uses the existing offer-comparison path to obtain the product variant's best eligible offer. Existing hard blockers remain authoritative: unverified or ambiguous mappings, region incompatibility, unavailable/unreliable purchasable terms, and no eligible verified offer exclude a candidate before scoring.

Active ownership is an additional hard purchase blocker. An active subscription or loan is not a hard blocker; it affects score and explanation only.

### Fixed policy constants

Deal Score v1 is a 0–100 score. Contributions are added, the temporary-access penalty is subtracted once, and the result is clamped to that range. Values and thresholds are fixed application-policy constants in this phase, not MCP or UI settings.

| Factor | Rule | Points |
|---|---|---:|
| Price-history quality | Current normalized final price is at or below the product variant's normalized historical low. | 40 |
|  | Above that low by up to 5%. | 30 |
|  | Above that low by more than 5% and up to 15%. | 20 |
|  | Above that low by more than 15%, or no comparable history exists. | 10 |
| Wishlist priority | Priority `3`, `2`, or `1`. | 25 / 15 / 5 |
| Target-price fit | A target exists and normalized final price is at or below target. | 20 |
|  | A target exists and price is above target by up to 10%. | 10 |
|  | No target, or price is above target by more than 10%. | 0 |
| Source confidence | High, medium, or low. | 5 / 3 / 1 |
| Retailer class | First-party storefront, authorized store, physical retailer, or marketplace. | 5 / 4 / 3 / 1 |
| Freshness | Offer observed within 24 hours; otherwise within 72 hours; otherwise older. | 5 / 3 / 0 |
| Active temporary access | Any active `subscription_access` or `loan` record. | -45 once |

Historical-low and target comparisons use normalized final price in the installation comparison currency. If that value is not available, the product has already failed the existing purchasable-offer eligibility gate and is excluded rather than scored. Historical-low comparisons use only observations in the same comparison currency.

### Verdict thresholds

| Score | Verdict |
|---:|---|
| 90–100 | `exceptional_buy` |
| 75–89 | `buy` |
| 60–74 | `good_deal` |
| 40–59 | `neutral` |
| 20–39 | `wait` |
| 0–19 | `skip` |

Results are ordered by score descending, then wishlist priority descending, then `productVariantId` ascending. This deterministic tie-break avoids recommendation churn.

## Recommendation output contract

The tool returns a structured result rather than an opaque score. Each recommendation contains:

- the wishlist entry and canonical product variant;
- the selected eligible offer, preserving the Phase 1 price, region, retailer, confidence, and history context;
- `score` and `verdict`;
- ordered factor contributions with factor name, signed points, and a concise rationale;
- `positiveFactors`, `negativeFactors`, and a stable summary explanation;
- access context sufficient to say whether ownership blocked the product or temporary access reduced its score.

The response also returns exclusions for wishlist products that could not be ranked, with product-variant identity and safe blocker reasons. An owned product must appear as excluded with an ownership blocker, never as a zero-score recommendation. The contract contains no raw provider responses, secrets, local filesystem paths, or stack traces.

## MCP surface and flows

All new tool inputs use the existing strict Zod pattern: unexpected properties and malformed values are rejected through the safe MCP error result, and successful results retain the existing `{ result: ... }` structured-content envelope.

| Tool | Annotation | Responsibility |
|---|---|---|
| `access_create` | Local mutation | Create a manual access record for an existing product variant. |
| `access_list` | Local read-only | List locally stored access records, optionally narrowed by canonical product variant. |
| `access_update` | Local mutation, idempotent when the full intended record is repeated | Update one local access record. |
| `access_remove` | Local mutation, destructive and idempotent | Remove one local access record. |
| `what_should_i_buy` | Local read-only | Rank only wishlist products using Deal Score v1 and return explanations/exclusions. |

The access tools expose only `manual` provenance in Phase 2. `what_should_i_buy` has no weight or threshold inputs. Evaluation time comes from the injected application clock, which tests can control; clients cannot alter ranking policy through request data.

```text
what_should_i_buy
  -> list wishlist entries
  -> resolve canonical product variants
  -> batch-load access records
  -> exclude active ownership
  -> use existing per-product offer comparison
  -> preserve existing offer blockers
  -> build normalized candidate facts
  -> DealScorePolicy.evaluate
  -> deterministic sort
  -> structured recommendations and exclusions
```

## Error handling

Phase 2 preserves the established public-error boundary. Invalid tool input, malformed UUIDs/timestamps, unsupported provenance values, invalid access intervals, and unknown access-record updates/removals follow the existing safe validation and mutation-result conventions. A missing referenced product variant maps to the established `product_not_found` category. SQLite failures map to `persistence_failure`; unexpected implementation failures remain `internal_error` with the existing generic message.

No tool may expose raw SQL, database contents, provider payloads, secret values, stack traces, or local paths. A recommendation with no eligible candidates is a successful, explainable empty result—not an infrastructure error.

## Testing strategy

Development follows RED → GREEN → REFACTOR. Tests must exercise real temporary SQLite databases for persistence behavior rather than replacing repository behavior with mocks.

| Layer | Required coverage |
|---|---|
| Domain/policy unit tests | Access-state validation, active-period boundary behavior, derived purchase status, each fixed score band, target-price thresholds, freshness thresholds, single temporary-access penalty, clamping, verdict thresholds, and deterministic ties. |
| Persistence tests | Migration ordering/checksum behavior, foreign-key safety, CRUD, batch lookup, effective-period persistence, restart persistence, and transaction rollback. |
| Application tests | Wishlist-only candidate discovery; inherited mapping/region/availability exclusions; owned hard blocking; temporary-access eligibility and penalty; output explanations; and no N+1 access lookup. |
| MCP integration tests | Tool discovery, strict schemas, annotations, CRUD persistence, malformed inputs, safe public errors, recommendation result/exclusion shape, and absence of sensitive data. |

## Acceptance criteria

Phase 2 is complete when all of the following are demonstrated:

1. Access records persist locally, refer only to existing canonical product variants, and survive process restart.
2. Access is modeled independently from wishlist intent; adding or removing an access record never creates, changes, or deletes a wishlist entry.
3. MCP clients can create, list, update, and remove manual `owned`, `subscription_access`, and `loan` records using strict schemas and safe errors.
4. `what_should_i_buy` ranks only persisted wishlist products and returns no non-wishlist candidate.
5. Existing mapping, regional compatibility, and purchasable-offer blockers continue to exclude candidates before Deal Score v1 runs.
6. Any active `owned` record excludes the product from purchase recommendations with an explicit ownership explanation.
7. Any active subscription or loan leaves the product eligible, applies exactly one -45-point contribution, and explains it.
8. Score weights, thresholds, clamping, verdicts, and tie-breaking match this document and are tested through an injected policy, not a client-configurable setting.
9. Each recommendation is decomposable into score contributions and contains a safe, stable explanation; exclusions are explicit.
10. Unit, persistence, application, and MCP integration tests cover the completed behavior and pass.

## Implementation handoff

The implementation plan should add the access domain, ports, SQLite migration/repository, application services, composition wiring, MCP adapters, and tests as one coherent Phase 2 slice. It must reuse Phase 1 catalog, offer comparison, public-error, migration, and strict-schema conventions rather than duplicating them.