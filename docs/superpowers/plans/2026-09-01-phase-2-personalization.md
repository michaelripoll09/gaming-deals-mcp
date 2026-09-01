# Phase 2 Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable local access records and a deterministic, explainable wishlist-only `what_should_i_buy` MCP recommendation flow.

**Architecture:** Keep access independent from wishlist intent. MCP delegates to application services; services depend on catalog, offer, wishlist, and access ports plus an injected clock and pure `DealScorePolicy`; SQLite is only an adapter. Reuse Phase 1 offer comparison before applying Phase 2 policy to surviving wishlist candidates.

**Tech Stack:** Node.js >=22.13.0, TypeScript ESM, Zod 4, Vitest 4, Node `node:sqlite`, and `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-09-01-phase-2-personalization-design.md`

## Global Constraints

- Preserve Phase 1 catalog identity, verified mapping, region, reliable-final-price, safe-error, strict-Zod, and checksummed transactional SQLite migration conventions.
- Use Node.js >=22.13.0, pnpm, TypeScript ESM, Zod, Vitest, and real temporary SQLite databases; keep `src/` strict-typecheckable.
- Access records reference canonical `ProductVariant.id` only; never a provider listing or a wishlist entry.
- Expose only `manual` provenance and `owned`, `subscription_access`, and `loan` states. An access record is active when `activeFrom` is absent or <= evaluation time and `activeUntil` is absent or > it; end is exclusive.
- Active ownership excludes purchase. Active subscription/loan remains purchasable but applies exactly one -45 contribution.
- Deal Score v1 is a fixed injected policy, not MCP/UI settings: 0–100, decomposable, deterministic sort score desc, priority desc, `productVariantId` asc.
- Recommendations use persisted wishlist entries only and existing offer eligibility before policy. Public MCP results remain `{ result: ... }`; errors must not leak SQL, payloads, secrets, paths, or stacks.
- Released migrations are immutable. Conventional commits only; no AI attribution. Every behavior starts with a demonstrably failing test.
- Do not add dashboard, scheduler/workers, alerts, budgets, purchases, connectors, Steam integration, providers/platforms, physical products, or score customization.

## File Map

| Path | Responsibility |
|---|---|
| `src/domain/access/types.ts` | Strict access schema, interval validation, active/derived purchase status. |
| `src/domain/recommendations/deal-score.ts` | Pure fixed Deal Score v1 policy, contribution/result types, explanations. |
| `src/application/ports.ts` | `AccessRepository` port. |
| `src/application/access-service.ts` | Canonical-product validation and access CRUD. |
| `src/application/recommendation-service.ts` | Wishlist orchestration, batch access lookup, exclusions, rank. |
| `src/persistence/sqlite/migrations/004_access_records.sql` | Access table, foreign key, checks, lookup indexes. |
| `src/persistence/sqlite/repositories.ts` | `SqliteAccessRepository`. |
| `src/composition/root.ts` | Repository/service/policy/clock wiring and `Application` facade. |
| `src/mcp/server.ts` | Strict access/recommendation schemas and handlers. |
| `tests/domain/access-types.test.ts`, `tests/domain/deal-score.test.ts` | Domain and pure-policy coverage. |
| `tests/persistence/migrations.test.ts`, `tests/persistence/repositories.test.ts` | Migration and access persistence coverage. |
| `tests/application/access-service.test.ts`, `tests/application/recommendation-service.test.ts` | Service/use-case coverage. |
| `tests/mcp/server.test.ts` | MCP discovery, schema, annotation, safe-result coverage. |

## Commit Plan

| Work unit | Tasks | Commit |
|---|---:|---|
| Access domain and storage | 1–2 | `feat(access): persist local product access records` |
| Access application boundary | 3 | `feat(access): add validated access service` |
| Explainable score policy | 4 | `feat(recommendations): add deterministic deal score policy` |
| Wishlist recommendation use case | 5 | `feat(recommendations): rank eligible wishlist deals` |
| MCP public surface | 6 | `feat(mcp): expose access and wishlist recommendations` |

Run `git diff --stat` before each commit; keep tests with the work unit and keep every unit independently reviewable.

---

### Task 1: Define the access domain and purchase-state rules

**Files:**
- Create: `src/domain/access/types.ts`
- Create: `tests/domain/access-types.test.ts`

**Interfaces:**
- Consumes: `isoTimestampSchema` from `src/domain/offers/types.ts`.
- Produces:

```ts
export type AccessState = 'owned' | 'subscription_access' | 'loan';
export type AccessProvenance = 'manual';
export interface AccessRecord { id: string; productVariantId: string; state: AccessState; provenance: AccessProvenance; activeFrom: string | null; activeUntil: string | null; createdAt: string; updatedAt: string; }
export type PurchaseAccess = { kind: 'owned'; activeRecords: AccessRecord[] } | { kind: 'temporary_access'; activeRecords: AccessRecord[] } | { kind: 'none'; activeRecords: [] };
export const accessRecordSchema: z.ZodType<AccessRecord>;
export function activeAccessRecords(records: AccessRecord[], evaluatedAt: string): AccessRecord[];
export function derivePurchaseAccess(records: AccessRecord[], evaluatedAt: string): PurchaseAccess;
```

- [ ] **Step 1: Write the failing test**

```ts
test('treats activeUntil as exclusive and owned as stronger than temporary access', () => {
  expect(derivePurchaseAccess([owned, subscription], now)).toMatchObject({ kind: 'owned' });
  expect(derivePurchaseAccess([loanEndingNow], loanEndingNow.activeUntil!)).toEqual({ kind: 'none', activeRecords: [] });
});
test('rejects an interval whose end is not later than its start', () => {
  expect(() => accessRecordSchema.parse({ ...loan, activeFrom: now, activeUntil: now })).toThrow();
});
```

Cover null bounds, future starts, expired records, all states, strict unknown keys, UUIDs, and ISO timestamps.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test tests/domain/access-types.test.ts`

Expected: FAIL because the access module and exports do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const accessRecordSchema = z.object({
  id: z.uuid(), productVariantId: z.uuid(), state: z.enum(['owned', 'subscription_access', 'loan']),
  provenance: z.literal('manual'), activeFrom: isoTimestampSchema.nullable(), activeUntil: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema, updatedAt: isoTimestampSchema,
}).strict().refine(({ activeFrom, activeUntil }) => activeFrom === null || activeUntil === null || activeUntil > activeFrom);
```

Filter active intervals after parsing, derive `owned` before `temporary_access`, and clone output records.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test tests/domain/access-types.test.ts && pnpm typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit later with Task 2**

Task 2 makes this persistent; do not make a partial work-unit commit.

### Task 2: Persist access records through a narrow repository port

**Files:**
- Modify: `src/application/ports.ts`
- Create: `src/persistence/sqlite/migrations/004_access_records.sql`
- Modify: `src/persistence/sqlite/repositories.ts`
- Modify: `tests/persistence/migrations.test.ts`
- Modify: `tests/persistence/repositories.test.ts`

**Interfaces:**
- Consumes: `AccessRecord`, existing `product_variants`, migration runner.
- Produces:

```ts
export interface AccessRepository {
  create(record: AccessRecord): Promise<void>;
  list(filter?: { productVariantId?: string }): Promise<AccessRecord[]>;
  update(record: AccessRecord): Promise<AccessRecord | null>;
  remove(accessRecordId: string): Promise<boolean>;
  listByProductVariantIds(productVariantIds: string[]): Promise<AccessRecord[]>;
}
export class SqliteAccessRepository implements AccessRepository { /* constructor(database: DatabaseSync) */ }
```

- [ ] **Step 1: Write the failing test**

```ts
test('persists access claims and batch-loads only requested variants', async () => {
  await repository.create(owned); await repository.create(subscriptionForOtherVariant);
  expect(await repository.listByProductVariantIds([owned.productVariantId])).toEqual([owned]);
});
test('rejects an unknown canonical product variant', async () => {
  await expect(repository.create(ownedWithUnknownVariant)).rejects.toThrow(/FOREIGN KEY constraint failed/);
});
```

Also assert versions `[1, 2, 3, 4]`, checksum safety, deterministic list/filter order, null interval round-trip, unknown update => `null`, unknown remove => `false`, transaction rollback, detached results, and reopen persistence.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test tests/persistence/migrations.test.ts tests/persistence/repositories.test.ts`

Expected: FAIL because migration 004 and the access port/repository are absent.

- [ ] **Step 3: Write minimal implementation**

Create `access_records` with UUID primary key, canonical-variant FK, checked states/provenance, nullable effective bounds, interval CHECK, audit timestamps, plus indexes whose leading column is `product_variant_id` and include effective-period values. Do not edit released migrations. Use prepared insert/select/update/delete statements, schema-parse every row, UPDATE only (no upsert), return `[]` immediately for an empty batch, bind only requested IDs, and clone results.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test tests/persistence/migrations.test.ts tests/persistence/repositories.test.ts && pnpm typecheck`

Expected: PASS; migration applies transactionally and existing Phase 1 tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/domain/access/types.ts src/application/ports.ts src/persistence/sqlite/migrations/004_access_records.sql src/persistence/sqlite/repositories.ts tests/domain/access-types.test.ts tests/persistence/migrations.test.ts tests/persistence/repositories.test.ts
git commit -m "feat(access): persist local product access records"
```
### Task 3: Add validated access application service and composition facade

**Files:**
- Create: `src/application/access-service.ts`
- Modify: `src/composition/root.ts`
- Create: `tests/application/access-service.test.ts`

**Interfaces:**
- Consumes: `CatalogRepository`, `AccessRepository`, `AccessRecord`, `PublicError`.
- Produces:

```ts
export type CreateAccessRecordInput = Omit<AccessRecord, 'id' | 'createdAt' | 'updatedAt' | 'activeFrom' | 'activeUntil'> & { activeFrom?: string | null; activeUntil?: string | null; now: string };
export class AccessService {
  constructor(accessRepository: AccessRepository, catalogRepository: CatalogRepository);
  create(input: CreateAccessRecordInput): Promise<AccessRecord>;
  list(filter?: { productVariantId?: string }): Promise<AccessRecord[]>;
  update(record: AccessRecord): Promise<AccessRecord | null>;
  remove(accessRecordId: string): Promise<boolean>;
}
export interface Application {
  createAccessRecord(input: CreateAccessRecordInput): Promise<AccessRecord>;
  listAccessRecords(filter?: { productVariantId?: string }): Promise<AccessRecord[]>;
  updateAccessRecord(record: AccessRecord): Promise<AccessRecord | null>;
  removeAccessRecord(accessRecordId: string): Promise<boolean>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
test('rejects an absent canonical product with product_not_found', async () => {
  await expect(application.createAccessRecord({ ...input, productVariantId: unknownId }))
    .rejects.toMatchObject({ code: 'product_not_found', message: 'Product variant was not found' });
});
test('updates/removes access without changing wishlist intent', async () => {
  const record = await application.createAccessRecord(input);
  await application.updateAccessRecord({ ...record, state: 'loan', updatedAt: later });
  await application.removeAccessRecord(record.id);
  expect(await application.listWishlistEntries()).toEqual([]);
});
```

Cover generated UUID/audit timestamps, all states, update product validation, unknown update/remove, persistence-failure mapping, and real-database reopen behavior.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test tests/application/access-service.test.ts`

Expected: FAIL because access service/facade methods do not exist.

- [ ] **Step 3: Write minimal implementation**

Mirror `WishlistService`: parse through `accessRecordSchema`, create UUIDs, verify `catalogRepository.findProductVariant` before create/update, throw `PublicError('product_not_found', 'Product variant was not found')` for absent identity, and wrap storage failures as `PublicError('persistence_failure', 'Persistent storage is unavailable', cause)`. Wire `SqliteAccessRepository` and four delegates in `createApplication`; do not modify wishlist schema/repository.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test tests/application/access-service.test.ts tests/application/wishlist-service.test.ts && pnpm typecheck`

Expected: PASS; access works and wishlist remains independent.

- [ ] **Step 5: Commit**

```bash
git add src/application/access-service.ts src/composition/root.ts tests/application/access-service.test.ts
git commit -m "feat(access): add validated access service"
```

### Task 4: Implement the pure explainable Deal Score v1 policy

**Files:**
- Create: `src/domain/recommendations/deal-score.ts`
- Create: `tests/domain/deal-score.test.ts`

**Interfaces:**
- Consumes: `PurchaseAccess`, `WishlistEntry`, `ProductVariant`, `Offer`, and `Money`.
- Produces:

```ts
export type DealVerdict = 'exceptional_buy' | 'buy' | 'good_deal' | 'neutral' | 'wait' | 'skip';
export interface DealScoreContribution { factor: string; points: number; rationale: string; }
export interface DealScoreCandidate { wishlistEntry: WishlistEntry; productVariant: ProductVariant; offer: Offer; historicalLow: Money | null; purchaseAccess: PurchaseAccess; evaluatedAt: string; comparisonCurrency: string; }
export interface DealScoreResult { score: number; verdict: DealVerdict; contributions: DealScoreContribution[]; positiveFactors: DealScoreContribution[]; negativeFactors: DealScoreContribution[]; explanation: string; }
export interface DealScorePolicy { evaluate(candidate: DealScoreCandidate): DealScoreResult; }
export class DealScoreV1Policy implements DealScorePolicy { evaluate(candidate: DealScoreCandidate): DealScoreResult; }
```

- [ ] **Step 1: Write the failing test**

```ts
test.each([[0, 'skip'], [19, 'skip'], [20, 'wait'], [39, 'wait'], [40, 'neutral'], [59, 'neutral'], [60, 'good_deal'], [74, 'good_deal'], [75, 'buy'], [89, 'buy'], [90, 'exceptional_buy']])(
  'maps score %i to %s', (score, verdict) => expect(verdictFor(score)).toBe(verdict),
);
test('applies exactly one visible -45 temporary-access contribution', () => {
  expect(policy.evaluate(withLoanAndSubscription).contributions.filter(({ factor }) => factor === 'temporary_access'))
    .toEqual([expect.objectContaining({ points: -45 })]);
});
```

Test every price-history band (at/below low, <=5%, <=15%, no history), priorities 1/2/3, target at/within 10%/outside 10%/currency mismatch, high/medium/low confidence, four retailer classes, freshness <=24h/<=72h/older, owned invariant, 0/100 clamp, stable factor order/partitions, and explanation.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test tests/domain/deal-score.test.ts`

Expected: FAIL because `DealScoreV1Policy` and types are absent.

- [ ] **Step 3: Write minimal implementation**

Use named fixed constants: price-history 40/30/20/10; priority 25/15/5; target 20/10/0; confidence 5/3/1; retailer 5/4/3/1; freshness 5/3/0; temporary access -45. Use integer minor-unit cross-multiplication for 5%, 15%, and 10% thresholds, only compare history/target in `comparisonCurrency`, and write a stable zero-point rationale for a target in another currency. Compare freshness with supplied evaluation time. Add factors in spec order, clamp, map exact verdict bands, and reject owned candidates as an invariant (service excludes them before policy).

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test tests/domain/deal-score.test.ts && pnpm typecheck`

Expected: PASS for every fixed weight/threshold/explanation assertion.

- [ ] **Step 5: Commit**

```bash
git add src/domain/recommendations/deal-score.ts tests/domain/deal-score.test.ts
git commit -m "feat(recommendations): add deterministic deal score policy"
```

### Task 5: Orchestrate wishlist-only recommendations through ports

**Files:**
- Create: `src/application/recommendation-service.ts`
- Modify: `src/composition/root.ts`
- Create: `tests/application/recommendation-service.test.ts`

**Interfaces:**
- Consumes: `WishlistRepository`, `CatalogRepository`, `AccessRepository`, `OfferService`, `DealScorePolicy`, injected `() => string` clock.
- Produces:

```ts
export interface RecommendationExclusion { productVariantId: string; blockers: string[]; }
export interface Recommendation { wishlistEntry: WishlistEntry; productVariant: ProductVariant; selectedOffer: { listing: ProviderListing; offer: Offer }; score: DealScoreResult; access: PurchaseAccess; }
export interface WhatShouldIBuyResult { recommendations: Recommendation[]; exclusions: RecommendationExclusion[]; }
export class RecommendationService {
  constructor(input: { wishlistRepository: WishlistRepository; catalogRepository: CatalogRepository; accessRepository: AccessRepository; offerService: OfferService; policy: DealScorePolicy; clock: () => string; comparisonCurrency: string; });
  whatShouldIBuy(): Promise<WhatShouldIBuyResult>;
}
export interface Application { whatShouldIBuy(): Promise<WhatShouldIBuyResult>; }
```

- [ ] **Step 1: Write the failing test**

```ts
test('ranks persisted wishlist entries only and batch-loads access once', async () => {
  await application.createWishlistEntry(wishlistCandidate);
  const result = await application.whatShouldIBuy();
  expect(result.recommendations.map(({ productVariant }) => productVariant.id)).toEqual([wishlistCandidate.productVariantId]);
  expect(accessRepository.listByProductVariantIds).toHaveBeenCalledTimes(1);
});
test('excludes owned but ranks temporary access with one -45 factor', async () => {
  expect(result.exclusions).toContainEqual({ productVariantId: ownedVariantId, blockers: ['Product is already owned'] });
  expect(result.recommendations[0]!.score.negativeFactors).toContainEqual(expect.objectContaining({ points: -45 }));
});
```

Use a spy only around a real repository batch method, never mocked persistence. Cover empty wishlist => successful empty arrays, non-wishlist offers never return, inherited no-selected offer blockers become exclusions, expired access has no effect, selected offer/access context survives, injected policy use, score/priority/UUID ties, and persistence-failure mapping.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test tests/application/recommendation-service.test.ts`

Expected: FAIL because the recommendation service and facade are absent.

- [ ] **Step 3: Write minimal implementation**

List wishlist once; call `listByProductVariantIds([...new Set(entries.map((entry) => entry.productVariantId))])` once. At one injected evaluation time, derive access. Exclude owned as `{ productVariantId, blockers: ['Product is already owned'] }` and never score it. For remaining entries, call existing `OfferService.compareProductVariant`; if `selected` is null, copy safe offer blockers, or its safe explanation when no per-offer blocker exists. Get history via existing `OfferService.listPriceHistory`, derive same-currency low, call policy, retain selected listing/offer/access, and sort by score desc, priority desc, variant ID asc. Wire `DealScoreV1Policy` and production `() => new Date().toISOString()`; allow a test clock in `createApplication` input.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test tests/application/recommendation-service.test.ts tests/application/access-service.test.ts tests/pricing/compare-offers.test.ts && pnpm typecheck`

Expected: PASS; pricing blockers precede policy, recommendation is wishlist-only, and access is batched once.

- [ ] **Step 5: Commit**

```bash
git add src/application/recommendation-service.ts src/composition/root.ts tests/application/recommendation-service.test.ts
git commit -m "feat(recommendations): rank eligible wishlist deals"
```

### Task 6: Expose strict MCP access and recommendation tools

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `tests/mcp/server.test.ts`

**Interfaces:**
- Consumes: `Application` methods, `accessRecordSchema`, `safeInputSchema`, `runValidatedTool`.
- Produces: `access_create`, `access_list`, `access_update`, `access_remove`, and `what_should_i_buy`.

```ts
'access_create' // { productVariantId, state, provenance: 'manual', activeFrom, activeUntil, now }
'access_list' // { productVariantId?: string }
'access_update' // complete AccessRecord
'access_remove' // { accessRecordId: string }
'what_should_i_buy' // {}
```

- [ ] **Step 1: Write the failing test**

```ts
test('discovers strict tools with accurate safety annotations', async () => {
  expect(toolNames).toContain('what_should_i_buy');
  expect(toolByName(tools, 'access_remove').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  expect(toolByName(tools, 'what_should_i_buy').inputSchema).toMatchObject({ additionalProperties: false });
});
test('returns safe temporary-access recommendation and ownership exclusion', async () => {
  expectSuccess(await client.callTool({ name: 'what_should_i_buy', arguments: {} }), expect.objectContaining({
    recommendations: expect.any(Array), exclusions: expect.arrayContaining([expect.objectContaining({ blockers: ['Product is already owned'] })]),
  }));
});
```

Add client CRUD tests for all states, list filter, update/delete idempotence, persistence, malformed UUID/timestamp/interval/provenance/unknown-key input, missing product => `product_not_found`, unknown record null/false behavior, and JSON assertions that no SQL, paths, raw provider payload, or secret fixture values leak.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test tests/mcp/server.test.ts`

Expected: FAIL because the five Phase 2 tools are absent.

- [ ] **Step 3: Write minimal implementation**

Derive schemas from `accessRecordSchema.shape`; make active bounds optional-and-nullable with a null default for create, require them for complete update, and use the existing invalid-input sentinel. `access_list`/`what_should_i_buy` are read-only; create is mutation; update is mutation/idempotent; remove is mutation/destructive/idempotent. `what_should_i_buy` accepts no policy inputs. Delegate one line through `runValidatedTool`; do not add MCP SQL or policy code.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test tests/mcp/server.test.ts && pnpm typecheck`

Expected: PASS; tool list is exactly Phase 1 plus five approved tools, strict schemas/error envelopes and annotations hold, and successes keep `{ result: ... }`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "feat(mcp): expose access and wishlist recommendations"
```

### Task 7: Run cross-boundary acceptance verification

**Files:**
- Modify only if a failing acceptance test proves a gap: `tests/application/recommendation-service.test.ts`, `tests/mcp/server.test.ts`, or `tests/persistence/repositories.test.ts`

**Interfaces:**
- Consumes: all finalized Phase 2 interfaces from Tasks 1–6.
- Produces: repeatable acceptance evidence; no new production interface.

- [ ] **Step 1: Write a failing acceptance test only if coverage is missing**

Exercise sync of deterministic data, two persisted wishlist entries, active owned access for one and active loan/subscription for the other, close/reopen, then MCP `what_should_i_buy`. Assert owned is an explicit exclusion, temporary access ranks with exactly one `-45` contribution, and no non-wishlist variant appears. Do not add production code unless this RED test proves a Phase 2 defect.

- [ ] **Step 2: Run the acceptance test to verify RED when a gap exists**

Run: `pnpm test tests/persistence/repositories.test.ts tests/application/recommendation-service.test.ts tests/mcp/server.test.ts`

Expected: FAIL only for a real missing behavior. If coverage already proves this, record `N/A — no missing acceptance behavior` and do not add a duplicate test.

- [ ] **Step 3: Make the smallest demonstrated correction**

Correct only the owning boundary: repository mapping, recommendation orchestration, or MCP adapter. Keep signatures and Phase 2 scope unchanged.

- [ ] **Step 4: Run complete verification**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: PASS; all Phase 1/2 unit, persistence, application, MCP, compilation, and migration-copy checks pass. Do not stage generated `dist/` artifacts.

- [ ] **Step 5: Commit only a necessary correction**

```bash
git add tests/application/recommendation-service.test.ts tests/mcp/server.test.ts tests/persistence/repositories.test.ts src/application/recommendation-service.ts src/mcp/server.ts src/persistence/sqlite/repositories.ts
git commit -m "test(recommendations): cover persisted access flow"
```

Create this commit only when Steps 1–3 found and fixed a real defect; otherwise Task 6 is the final implementation commit.

## Coverage Mapping

| Spec requirement | Tasks and evidence |
|---|---|
| Dedicated independent access module | 1 domain contract; 3 independence test; 5 wishlist-only test. |
| Manual CRUD linked to canonical variants; effective periods/derived status | 1 schemas/boundaries; 2 persistence; 3 services; 6 MCP. |
| Checksummed transactional migration, FK/indexes, restart/rollback | 2 migration/repository tests; 7 reopened MCP flow. |
| Narrow batch access port/no N+1 access lookup | 2 port; 5 exact one batch-call assertion. |
| Fixed injected Deal Score v1, contributions, clamp, verdicts | 4 policy decision-table tests; 5 injection coverage. |
| Wishlist-only use case reusing Phase 1 eligibility | 5 `OfferService.compareProductVariant` orchestration; 7 acceptance flow. |
| Owned blocker and temporary-access -45 once | 1 derived state; 4 factor test; 5 output; 6 MCP; 7 restart proof. |
| Deterministic order and explicit safe exclusions | 4 stable policy; 5 score/priority/UUID and offer-blocker tests. |
| Strict MCP schemas/annotations/safe envelopes | 6 discovery, malformed-input, output-leak tests. |
| Required unit/persistence/application/MCP verification | Focused RED/GREEN in 1–6; full suite/build in 7. |

## Plan Self-Review Evidence

- **Spec coverage:** Each included scope item and all ten acceptance criteria map above. Global Constraints repeats the explicit non-goals; no task adds them.
- **Placeholder scan:** Checked every prohibited placeholder category from the writing-plans skill. No placeholder remains. Every implementation task has concrete test behavior, RED/GREEN command/expected outcome, minimal code direction, and commit.
- **Type consistency:** `AccessRecord`, `AccessRepository`, `AccessService`, `DealScorePolicy`, `RecommendationService`, `WhatShouldIBuyResult`, `listByProductVariantIds(productVariantIds: string[])`, `whatShouldIBuy()`, and MCP `what_should_i_buy` use identical names and shapes across producer/consumer tasks.

## Risks and Guards

- `OfferComparisonResult` lacks numeric history low, so Task 5 gets history through existing `OfferService.listPriceHistory`; the policy calculates only same-currency lows.
- Phase 1 permits a wishlist target in any currency. Task 4 awards zero target-fit points and explains it when target and comparison currencies differ; it never invents conversion.
- SQLite FK is a backstop, while Task 3 supplies the public canonical-product validation contract.
- Per-wishlist offer comparison intentionally reuses Phase 1. Phase 2 forbids N+1 access queries specifically; defer offer batching until measured and separately scoped.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-01-phase-2-personalization.md`. Execute task-by-task with subagent-driven development (recommended) or inline execution with checkpoints.
