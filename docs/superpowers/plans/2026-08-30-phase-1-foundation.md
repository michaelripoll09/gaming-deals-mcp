# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the smallest persistent PC Gaming Deals MCP flow: deterministic catalog sync, safe regional offer comparison, price history, local wishlist, MCP tools, and CLI diagnostics.

**Architecture:** Build one TypeScript ESM modular monolith. MCP and CLI adapters call application services, which depend only on domain contracts and ports. SQLite is the source of truth; deterministic and real providers use the same Zod-validated ingestion path.

**Tech Stack:** Node.js >=22.13.0, pnpm, TypeScript ESM, Zod, Vitest, Node `node:sqlite`, and `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-08-30-phase-1-foundation-design.md`

## Quick path

1. Complete every task in RED -> verify failure -> GREEN -> verify pass -> REFACTOR order.
2. Commit each completed work unit with its tests and evidence.
3. Keep the PR slices separate; never combine them into a review above 400 authored changed lines.

## Global Constraints

- Use Node.js >=22.13.0; Node `node:sqlite` needs no experimental flag from this Node 22 release onward.
- Use pnpm, TypeScript ESM, Zod boundary validation, Vitest, and real temporary SQLite files.
- Default configuration is country `CO` and comparison currency `COP`; both are installation configuration, never domain constants.
- Store every money amount as an integer minor unit; never use floating point for persisted amounts.
- Migrations are ordered, SHA-256 checksummed, and transactionally applied. Released migration files are immutable.
- Only verified provider mappings can win a definitive comparison. Incompatible regions are hard blockers; unknown regions remain visible as unknown.
- Preserve original price/currency separately from normalized final price/currency, exchange-rate source, and conversion time.
- MCP and CLI errors expose only stable code/message pairs, never secrets, raw payloads, stack traces, database content, or absolute local paths.
- Destination URLs must use HTTPS; buying remains manual.
- Conventional commits only; no AI attribution.
- Every behavior begins with a test that demonstrably fails for the missing behavior.

## PR slices

| Slice | Tasks | Target review size | Outcome |
|---|---:|---:|---|
| PR 1: runtime and storage | 1-2 | 320-380 lines | Runnable package, safe config/errors, SQLite migrations. |
| PR 2: catalog and providers | 3-4 | 360-400 lines | Canonical identity and deterministic validated provider. |
| PR 3: pricing and services | 5-6 | 360-400 lines | Explainable selection, sync/history, wishlist. |
| PR 4: public adapters | 7-8 | 350-400 lines | MCP tools and safe CLI doctor. |
| PR 5: real-provider gate | 9 | 250-380 lines | Real adapter only after access evidence passes. |

Before each PR, run `git diff --stat`. If a slice exceeds 400 additions plus deletions, split at the next whole task boundary; never separate code from its tests.

## File map

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | ESM runtime, scripts, strict compilation, tests. |
| `src/config/config.ts` | Zod configuration and CO/COP defaults. |
| `src/errors/public-error.ts` | Stable public error envelope. |
| `src/domain/catalog/types.ts` | Game, release, edition, product variant identity. |
| `src/domain/offers/types.ts` | Mapping, listing, offer, money, price observation types. |
| `src/domain/wishlist/types.ts` | Validated persistent wishlist model. |
| `src/domain/providers/contracts.ts` | Capability and normalized sync boundary schema. |
| `src/domain/pricing/*.ts` | Eligibility filtering and deterministic selection. |
| `src/providers/deterministic/*.ts` | Stable provider fixtures and adapter. |
| `src/application/*.ts` | Repository ports and adapter-neutral use cases. |
| `src/persistence/sqlite/*` | Migration runner, SQLite opening, and repositories. |
| `src/composition/root.ts` | Explicit runtime composition. |
| `src/mcp/*.ts`, `src/cli/*.ts` | Public MCP and CLI adapters. |
| `tests/**` | Unit, contract, persistence, application, MCP, and CLI tests. |

## Shared interfaces

~~~ts
// src/domain/catalog/types.ts
export type Platform = 'pc';
export type Distribution = 'digital_storefront' | 'digital_key';

export interface Game { id: string; canonicalTitle: string; }
export interface Release { id: string; gameId: string; title: string; releaseYear: number; }
export interface Edition { id: string; releaseId: string; name: string; }
export interface ProductVariant {
  id: string;
  editionId: string;
  platform: Platform;
  distribution: Distribution;
  regionCode: string | null;
}

// src/domain/offers/types.ts
export type MappingState = 'verified' | 'probable' | 'ambiguous' | 'unmatched';
export type RegionStatus = 'compatible' | 'incompatible' | 'unknown';
export type RetailerClass = 'authorized_store' | 'marketplace' | 'first_party_storefront' | 'physical_retailer';
export type SourceConfidence = 'high' | 'medium' | 'low';

export interface Money { amountMinor: number; currency: string; }
export interface ProviderListing {
  id: string; providerId: string; providerProductId: string;
  productVariantId: string | null; mappingState: MappingState;
}
export interface Offer {
  id: string; providerListingId: string; sourceObservationKey: string;
  originalPrice: Money; normalizedPrice: Money | null; normalizedFinalPrice: Money | null;
  exchangeRateSource: string | null; convertedAt: string | null;
  regionStatus: RegionStatus; retailerClass: RetailerClass; sourceConfidence: SourceConfidence;
  shippingKnown: boolean; taxesKnown: boolean; destinationUrl: string; observedAt: string;
}
export interface PriceObservation {
  id: string; offerId: string; providerListingId: string; sourceObservationKey: string;
  originalPrice: Money; normalizedPrice: Money | null; observedAt: string;
}

// src/domain/wishlist/types.ts
export interface WishlistEntry {
  id: string; productVariantId: string; priority: 1 | 2 | 3;
  targetPrice: Money | null; notes: string | null; createdAt: string; updatedAt: string;
}
~~~

~~~ts
// src/application/ports.ts
export interface CatalogRepository {
  search(query: string): Promise<ProductVariant[]>;
  findProductVariant(productVariantId: string): Promise<ProductVariant | null>;
  upsertCatalog(input: { game: Game; release: Release; edition: Edition; productVariant: ProductVariant }): Promise<void>;
}
export interface OfferRepository {
  upsertListing(listing: ProviderListing): Promise<void>;
  upsertCurrentOffer(offer: Offer): Promise<void>;
  appendPriceObservation(observation: PriceObservation): Promise<'inserted' | 'already_exists'>;
  listOffers(productVariantId: string): Promise<Offer[]>;
  listPriceHistory(productVariantId: string): Promise<PriceObservation[]>;
}
export interface WishlistRepository {
  create(entry: WishlistEntry): Promise<void>;
  list(): Promise<WishlistEntry[]>;
  update(entry: WishlistEntry): Promise<WishlistEntry | null>;
  remove(wishlistEntryId: string): Promise<boolean>;
}
~~~

~~~ts
// src/domain/providers/contracts.ts
export interface DealProvider {
  readonly capability: {
    providerId: string; displayName: string; retailerClass: RetailerClass;
    sourceConfidence: SourceConfidence; supportedCountries: string[];
    authentication: 'none' | 'api_key'; enabledByDefault: boolean;
  };
  sync(input: { country: string; comparisonCurrency: string; now: string }): Promise<unknown>;
}
~~~

---

### Task 1: Establish the ESM package, validated configuration, and safe errors

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/config/config.ts`, `src/errors/public-error.ts`
- Test: `tests/config/config.test.ts`, `tests/errors/public-error.test.ts`

**Interfaces:**
- Produces: `loadConfig(environment: NodeJS.ProcessEnv): AppConfig`
- Produces: `toPublicError(error: unknown): PublicErrorEnvelope`
- Consumed by: Tasks 2, 6, 7, and 8.

- [ ] **Step 1: Write failing tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config/config.js';

describe('loadConfig', () => {
  test('uses CO and COP defaults', () => {
    expect(loadConfig({ GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite' }))
      .toMatchObject({ country: 'CO', comparisonCurrency: 'COP', databasePath: 'C:/tmp/deals.sqlite' });
  });

  test('rejects an invalid comparison currency', () => {
    expect(() => loadConfig({
      GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite',
      GAMING_DEALS_COMPARISON_CURRENCY: 'COPP',
    })).toThrow('Invalid configuration');
  });
});
~~~

~~~ts
import { describe, expect, test } from 'vitest';
import { PublicError, toPublicError } from '../../src/errors/public-error.js';

describe('toPublicError', () => {
  test('does not expose cause metadata', () => {
    expect(toPublicError(new PublicError('provider_unavailable', 'Provider unavailable', {
      apiKey: 'secret-value', path: 'C:/Users/private/deals.sqlite',
    }))).toEqual({ code: 'provider_unavailable', message: 'Provider unavailable' });
  });

  test('does not expose unknown error messages', () => {
    expect(toPublicError(new Error('C:/Users/private/token=secret-value')))
      .toEqual({ code: 'internal_error', message: 'An unexpected error occurred' });
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/config/config.test.ts tests/errors/public-error.test.ts`

Expected: FAIL because the imported production modules do not exist.

- [ ] **Step 3: Implement the minimum runtime**

Create this exact package baseline, then run `pnpm install` to create `pnpm-lock.yaml`.

~~~json
{
  "name": "gaming-deals-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13.0", "pnpm": ">=10.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/cli/main.js",
    "mcp": "node dist/cli/main.js mcp",
    "doctor": "node dist/cli/main.js doctor"
  },
  "dependencies": { "@modelcontextprotocol/sdk": "1.30.0", "zod": "4.5.4" },
  "devDependencies": { "@types/node": "22.20.0", "typescript": "5.9.3", "vitest": "4.1.11" }
}
~~~

Implement `config.ts` with a Zod object that maps `GAMING_DEALS_COUNTRY`, `GAMING_DEALS_COMPARISON_CURRENCY`, `GAMING_DEALS_DATABASE_PATH`, and optional `GAMING_DEALS_PROVIDER_API_KEY`; uppercase country/currency; and throws exactly `Invalid configuration` on a failed parse. Implement `PublicError` and `toPublicError` with public codes `invalid_configuration`, `provider_unavailable`, `provider_data_invalid`, `ambiguous_mapping`, `product_not_found`, `region_incompatible`, `persistence_failure`, and `internal_error`.

Use strict TypeScript NodeNext settings. Ignore `node_modules/`, `dist/`, `coverage/`, `.env`, and `*.sqlite`. `.env.example` contains only:
~~~dotenv
GAMING_DEALS_COUNTRY=CO
GAMING_DEALS_COMPARISON_CURRENCY=COP
GAMING_DEALS_DATABASE_PATH=./gaming-deals.sqlite
GAMING_DEALS_PROVIDER_API_KEY=
~~~

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm install
pnpm vitest run tests/config/config.test.ts tests/errors/public-error.test.ts
pnpm typecheck
~~~

Expected: four tests PASS; typecheck exits 0.

- [ ] **Step 5: REFACTOR while green**

Extract a private environment mapping only if it removes duplicate environment-key access. Re-run Step 4.

- [ ] **Step 6: Record evidence and commit**

Runtime evidence: `node --version; pnpm --version; pnpm test` reports Node >=22.13.0, pnpm >=10.0.0, and passing tests. Rollback boundary: only Task 1 files; no persistent schema exists.

~~~bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore .env.example src/config/config.ts src/errors/public-error.ts tests/config/config.test.ts tests/errors/public-error.test.ts
git commit -m "feat(core): initialize runtime configuration and safe errors"
~~~

### Task 2: Add checksummed transactional SQLite migrations

**Files:**
- Create: `src/persistence/sqlite/migrations/001_initial.sql`
- Create: `src/persistence/sqlite/migrations.ts`, `src/persistence/sqlite/database.ts`
- Create: `tests/helpers/temp-database.ts`, `tests/persistence/migrations.test.ts`

**Interfaces:**
- Produces: `openDatabase(databasePath: string): { database: DatabaseSync; close(): void }`
- Produces: `applyMigrations(database: DatabaseSync): void`
- Consumed by: repositories and CLI doctor.

- [ ] **Step 1: Write failing migration tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import { createTemporaryDatabasePath } from '../helpers/temp-database.js';

describe('openDatabase', () => {
  test('migrates then safely reopens a database', () => {
    const path = createTemporaryDatabasePath();
    const first = openDatabase(path);
    expect(first.database.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    first.close();
    const second = openDatabase(path);
    expect(second.database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'wishlist_entries')).toEqual({ name: 'wishlist_entries' });
    second.close();
  });

  test('rejects a future schema version', () => {
    const path = createTemporaryDatabasePath();
    const database = new DatabaseSync(path);
    database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    database.exec("INSERT INTO schema_migrations VALUES (999, 'future', '2026-08-30T00:00:00.000Z')");
    database.close();
    expect(() => openDatabase(path)).toThrow('Unsupported future schema version');
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/persistence/migrations.test.ts`

Expected: FAIL because the database module does not exist.

- [ ] **Step 3: Implement schema and runner**

The migration creates `schema_migrations`, `games`, `releases`, `editions`, `product_variants`, `provider_listings`, `offers`, `price_observations`, and `wishlist_entries` as SQLite `STRICT` tables with foreign keys.

The following constraints are mandatory:

~~~sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE provider_listings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  product_variant_id TEXT,
  mapping_state TEXT NOT NULL CHECK (mapping_state IN ('verified', 'probable', 'ambiguous', 'unmatched')),
  UNIQUE (provider_id, provider_product_id),
  FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
) STRICT;

CREATE TABLE price_observations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  provider_listing_id TEXT NOT NULL,
  source_observation_key TEXT NOT NULL,
  original_amount_minor INTEGER NOT NULL CHECK (original_amount_minor >= 0),
  original_currency TEXT NOT NULL CHECK (length(original_currency) = 3),
  normalized_amount_minor INTEGER,
  comparison_currency TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (provider_listing_id, source_observation_key),
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (provider_listing_id) REFERENCES provider_listings(id)
) STRICT;
~~~

Use SHA-256 of the exact UTF-8 SQL source. Before each pending migration, reject an applied checksum mismatch and any recorded version above the highest bundled version. Apply pending migrations in `BEGIN IMMEDIATE` / `COMMIT`, issue `ROLLBACK` on error, and set `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` at open.

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/persistence/migrations.test.ts
pnpm typecheck
~~~

Expected: both real-file migration tests PASS; typecheck exits 0.

- [ ] **Step 5: REFACTOR, evidence, and commit**

Keep connection lifecycle in `database.ts` and migration discovery/checksum logic in `migrations.ts`; re-run Step 4. Runtime evidence: `pnpm vitest run tests/persistence/migrations.test.ts --reporter=verbose` proves restart safety and future-version rejection. Rollback: before release, revert Task 2 files; after release, append a new migration rather than edit `001_initial.sql`.

~~~bash
git add src/persistence/sqlite/migrations/001_initial.sql src/persistence/sqlite/migrations.ts src/persistence/sqlite/database.ts tests/helpers/temp-database.ts tests/persistence/migrations.test.ts
git commit -m "feat(persistence): add checked SQLite migrations"
~~~

### Task 3: Define pure canonical, offer, wishlist, and provider-boundary contracts

**Files:**
- Create: `src/domain/catalog/types.ts`, `src/domain/offers/types.ts`, `src/domain/wishlist/types.ts`, `src/domain/providers/contracts.ts`
- Test: `tests/domain/catalog-types.test.ts`, `tests/domain/provider-contract.test.ts`

**Interfaces:**
- Produces: the interfaces in **Shared interfaces**.
- Produces: `normalizedProviderSyncSchema` and `wishlistEntrySchema`.
- Consumed by: all provider, pricing, persistence, and application code.

- [ ] **Step 1: Write failing Zod-boundary tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { normalizedProviderSyncSchema } from '../../src/domain/providers/contracts.js';

describe('normalizedProviderSyncSchema', () => {
  test('rejects a non-HTTPS destination URL', () => {
    const result = normalizedProviderSyncSchema.safeParse({
      catalog: [], listings: [], offers: [{
        id: '6c86d8de-9f26-494f-9462-e2f74b00b0fb',
        providerListingId: 'd0075e12-e721-4d0c-8ed4-0b5e49f18bd2',
        sourceObservationKey: '2026-08-30T00:00:00.000Z',
        originalPrice: { amountMinor: 4999000, currency: 'COP' },
        normalizedPrice: { amountMinor: 4999000, currency: 'COP' },
        normalizedFinalPrice: { amountMinor: 4999000, currency: 'COP' },
        exchangeRateSource: 'identity', convertedAt: '2026-08-30T00:00:00.000Z',
        regionStatus: 'compatible', retailerClass: 'authorized_store', sourceConfidence: 'high',
        shippingKnown: true, taxesKnown: true, destinationUrl: 'http://example.test/game',
        observedAt: '2026-08-30T00:00:00.000Z',
      }],
    });
    expect(result.success).toBe(false);
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run tests/domain/provider-contract.test.ts`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement only pure contracts**

Implement each enum with Zod, export TypeScript types from the schemas, and make `normalizedProviderSyncSchema` require a nonempty catalog/listing/offer array, UUID identities, ISO timestamps, nonnegative integer minor amounts, three-letter uppercase currency, and an HTTPS `destinationUrl`. Implement `wishlistEntrySchema` with priority 1/2/3, optional target money, ISO timestamps, and notes at most 2,000 characters. No `src/domain/**` file imports Node, SQLite, MCP, CLI, HTTP, or a provider library.

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/domain/catalog-types.test.ts tests/domain/provider-contract.test.ts
pnpm typecheck
~~~

Expected: malformed boundary data is rejected; all tests pass.

- [ ] **Step 5: REFACTOR, evidence, and commit**

Reuse schemas from their owning module rather than duplicate enum literals. Re-run Step 4. Runtime evidence: `pnpm test` passes without provider or persistence mocks. Rollback: revert only these pure domain files/tests.

~~~bash
git add src/domain tests/domain
git commit -m "feat(domain): define catalog and provider contracts"
~~~

### Task 4: Add the deterministic provider as the contract reference

**Files:** Create src/providers/deterministic/fixtures.ts and src/providers/deterministic/deterministic-provider.ts. Test tests/providers/deterministic-provider.test.ts.

**Interfaces:** consumes DealProvider, providerCapabilitySchema, normalizedProviderSyncSchema. Produces class DeterministicDealProvider implements DealProvider with sync(input: { country: string; comparisonCurrency: string; now: string }): Promise<unknown>. It is consumed by Task 6 ingestion, Task 8 doctor, and MCP sync.

- [ ] **Step 1: Write the failing provider-contract tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { normalizedProviderSyncSchema } from '../../src/domain/providers/contracts.js';
import { DeterministicDealProvider } from '../../src/providers/deterministic/deterministic-provider.js';

describe('DeterministicDealProvider', () => {
  test('declares a non-secret PC capability and emits stable fixtures', async () => {
    const provider = new DeterministicDealProvider();
    const input = { country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z' };
    const first = await provider.sync(input);
    const second = await provider.sync(input);
    expect(provider.capability).toMatchObject({
      providerId: 'deterministic', supportedCountries: ['CO'],
      authentication: 'none', enabledByDefault: true,
    });
    expect(normalizedProviderSyncSchema.parse(first)).toEqual(second);
  });

  test('contains an ambiguous mapping fixture that cannot later win', async () => {
    const provider = new DeterministicDealProvider();
    const result = normalizedProviderSyncSchema.parse(await provider.sync({
      country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z',
    }));
    expect(result.listings.some((listing) => listing.mappingState === 'ambiguous')).toBe(true);
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm vitest run tests/providers/deterministic-provider.test.ts

Expected: FAIL because the provider module does not exist.

- [ ] **Step 3: Implement stable boundary-validated fixtures**

Implement DeterministicDealProvider with one verified PC digital-storefront variant compatible with CO, one verified variant with regionStatus incompatible, and one ambiguous listing. Use fixed UUIDs, source-observation keys, timestamps, original/normalized COP integer amounts, and https://example.test destinations. Its sync method calls normalizedProviderSyncSchema.parse(fixture) before returning. Fixtures are readonly data and contain no network request, time read, random UUID, environment read, or secret.

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/providers/deterministic-provider.test.ts
pnpm typecheck
~~~

Expected: both tests PASS and identical input returns equal output.

- [ ] **Step 5: REFACTOR, evidence, and commit**

Keep data in fixtures.ts and adapter behavior in deterministic-provider.ts; re-run Step 4. Runtime evidence: pnpm vitest run tests/providers/deterministic-provider.test.ts --reporter=verbose shows stable output and ambiguous coverage. Rollback: revert only Task 4 provider/test files.

~~~bash
git add src/providers/deterministic tests/providers/deterministic-provider.test.ts
git commit -m "feat(providers): add deterministic deal provider"
~~~

### Task 5: Implement regional eligibility and explainable offer ranking

**Files:** Create src/domain/pricing/eligibility.ts and src/domain/pricing/compare-offers.ts. Test tests/pricing/compare-offers.test.ts.

**Interfaces:**
~~~ts
export interface EligibilityDecision {
  eligible: boolean;
  blockers: string[];
  cautions: string[];
}
export interface OfferComparisonResult {
  selected: { listing: ProviderListing; offer: Offer } | null;
  positiveFactors: string[];
  negativeFactors: string[];
  blockers: Array<{ offerId: string; reasons: string[] }>;
  explanation: string;
}
export function evaluateEligibility(input: {
  listing: ProviderListing; offer: Offer; country: string; comparisonCurrency: string;
}): EligibilityDecision;
export function selectBestOffer(input: {
  productVariant: ProductVariant;
  candidates: Array<{ listing: ProviderListing; offer: Offer }>;
  country: string; comparisonCurrency: string; history: PriceObservation[];
}): OfferComparisonResult;
~~~

- [ ] **Step 1: Write failing selection tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { selectBestOffer } from '../../src/domain/pricing/compare-offers.js';

const productVariant = {
  id: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
  editionId: '64b514cb-0e12-4e0b-97e5-da0e2c67dbe8',
  platform: 'pc' as const, distribution: 'digital_storefront' as const, regionCode: 'CO',
};

describe('selectBestOffer', () => {
  test('selects the lowest reliable final COP price with an explanation', () => {
    const result = selectBestOffer({
      productVariant, country: 'CO', comparisonCurrency: 'COP', history: [],
      candidates: [{
        listing: { id: 'd0075e12-e721-4d0c-8ed4-0b5e49f18bd2', providerId: 'deterministic', providerProductId: 'safe', productVariantId: productVariant.id, mappingState: 'verified' },
        offer: { id: '6c86d8de-9f26-494f-9462-e2f74b00b0fb', providerListingId: 'd0075e12-e721-4d0c-8ed4-0b5e49f18bd2', sourceObservationKey: 'safe', originalPrice: { amountMinor: 4000000, currency: 'COP' }, normalizedPrice: { amountMinor: 4000000, currency: 'COP' }, normalizedFinalPrice: { amountMinor: 4000000, currency: 'COP' }, exchangeRateSource: 'identity', convertedAt: '2026-08-30T00:00:00.000Z', regionStatus: 'compatible', retailerClass: 'authorized_store', sourceConfidence: 'high', shippingKnown: true, taxesKnown: true, destinationUrl: 'https://example.test/safe', observedAt: '2026-08-30T00:00:00.000Z' },
      }],
    });
    expect(result.selected?.offer.id).toBe('6c86d8de-9f26-494f-9462-e2f74b00b0fb');
    expect(result.positiveFactors).toContain('Verified mapping');
    expect(result.explanation).toContain('COP');
  });

  test('does not choose when no eligible verified candidate exists', () => {
    const result = selectBestOffer({
      productVariant, country: 'CO', comparisonCurrency: 'COP', history: [], candidates: [],
    });
    expect(result.selected).toBeNull();
    expect(result.explanation).toBe('No eligible verified offer is available for CO.');
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm vitest run tests/pricing/compare-offers.test.ts

Expected: FAIL because pricing modules do not exist.

- [ ] **Step 3: Implement hard filtering then deterministic ranking**

Apply these rules in this exact order:
1. mapping other than verified -> blocker Mapping is not verified;
2. incompatible region -> blocker Offer is incompatible with CO;
3. missing normalized final price or non-COP final currency -> blocker Reliable COP final price is unavailable;
4. unknown region remains eligible with caution Region compatibility is unknown;
5. sort survivors by final normalized minor amount ascending, source confidence high/medium/low, retailer class first-party-storefront/authorized-store/physical-retailer/marketplace, then lexical offer ID.

The explanation includes product-variant ID, original/normalized money, region, retailer class, confidence, known shipping/tax state, historical normalized low, positive factors, negative factors, and exclusion blockers. Use Intl.NumberFormat only for wording; retain integer values in structured output.

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/pricing/compare-offers.test.ts
pnpm typecheck
~~~

Expected: eligible offer selection passes; ambiguous and incompatible candidates cannot win.

- [ ] **Step 5: REFACTOR, evidence, and commit**

After green only, extract a private rank-key helper if comparison code is duplicated. Runtime evidence: pnpm vitest run tests/pricing/compare-offers.test.ts --reporter=verbose proves exclusions and stable selection. Rollback: revert Task 5 pricing files/test only.

~~~bash
git add src/domain/pricing tests/pricing/compare-offers.test.ts
git commit -m "feat(pricing): select eligible offers with explanations"
~~~

### Task 6: Persist ingestion, observations, comparison, and wishlist through application ports

**Files:** Create src/application/ports.ts, src/application/sync-provider.ts, src/application/catalog-service.ts, src/application/offer-service.ts, src/application/wishlist-service.ts, src/persistence/sqlite/repositories.ts, and src/composition/root.ts. Test tests/persistence/repositories.test.ts, tests/application/provider-sync.test.ts, tests/application/wishlist-service.test.ts.

**Interfaces:**
~~~ts
export function createApplication(input: {
  databasePath: string; country: string; comparisonCurrency: string;
}): {
  syncDeterministicProvider(observedAt: string): Promise<{ catalogCount: number; listingCount: number; offerCount: number; observationCount: number }>;
  searchCatalog(query: string): Promise<ProductVariant[]>;
  compareProductVariant(productVariantId: string): Promise<OfferComparisonResult>;
  listPriceHistory(productVariantId: string): Promise<PriceObservation[]>;
  createWishlistEntry(input: Omit<WishlistEntry, 'id' | 'createdAt' | 'updatedAt'> & { now: string }): Promise<WishlistEntry>;
  listWishlistEntries(): Promise<WishlistEntry[]>;
  updateWishlistEntry(entry: WishlistEntry): Promise<WishlistEntry | null>;
  removeWishlistEntry(wishlistEntryId: string): Promise<boolean>;
  close(): void;
};
~~~

- [ ] **Step 1: Write failing real-database application tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { createApplication } from '../../src/composition/root.js';
import { createTemporaryDatabasePath } from '../helpers/temp-database.js';

describe('persistent application services', () => {
  test('does not append duplicate observations for the same sync replay', async () => {
    const application = createApplication({
      databasePath: createTemporaryDatabasePath(), country: 'CO', comparisonCurrency: 'COP',
    });
    const first = await application.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
    const second = await application.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
    expect(first.observationCount).toBeGreaterThan(0);
    expect(second.observationCount).toBe(0);
    application.close();
  });

  test('persists a wishlist entry after reopening', async () => {
    const databasePath = createTemporaryDatabasePath();
    const first = createApplication({ databasePath, country: 'CO', comparisonCurrency: 'COP' });
    await first.createWishlistEntry({
      productVariantId: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
      priority: 1, targetPrice: { amountMinor: 3500000, currency: 'COP' },
      notes: 'Play with friends', now: '2026-08-30T00:00:00.000Z',
    });
    first.close();
    const second = createApplication({ databasePath, country: 'CO', comparisonCurrency: 'COP' });
    expect(await second.listWishlistEntries()).toHaveLength(1);
    second.close();
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm vitest run tests/application/provider-sync.test.ts tests/application/wishlist-service.test.ts

Expected: FAIL because application services and composition root do not exist.

- [ ] **Step 3: Implement ports, real repositories, and transactions**

Implement SqliteCatalogRepository, SqliteOfferRepository, and SqliteWishlistRepository with prepared statements. In syncProvider call provider.sync once, parse normalizedProviderSyncSchema, upsert the Game -> Release -> Edition -> ProductVariant chain/listings/current offers, and append observations via UNIQUE(provider_listing_id, source_observation_key), all in one SQLite transaction. Map schema failure to PublicError(provider_data_invalid, Provider data is invalid), storage failure to PublicError(persistence_failure, Persistent storage is unavailable), and preserve existing committed state when a sync fails.

Wishlist update returns null for an unknown ID and never inserts a new row; remove returns false for an unknown ID. Services contain no SQL and close only through application.close().

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/persistence/repositories.test.ts tests/application/provider-sync.test.ts tests/application/wishlist-service.test.ts
pnpm typecheck
~~~

Expected: real temporary databases prove idempotency, transaction rollback, history persistence, and wishlist restart persistence.

- [ ] **Step 5: REFACTOR, evidence, and commit**

Keep SQL-to-domain mapping private to repositories.ts. Runtime evidence: pnpm test passes all prior layers; record exact output in PR description. Rollback: revert Task 6 application/repository/composition files together; never add destructive rollback code.

~~~bash
git add src/application src/composition src/persistence/sqlite/repositories.ts tests/persistence/repositories.test.ts tests/application
git commit -m "feat(application): persist deterministic offers and wishlist"
~~~

### Task 7: Expose validated MCP catalog, comparison, history, sync, and wishlist tools

**Files:** Create src/mcp/tool-results.ts and src/mcp/server.ts. Test tests/mcp/server.test.ts.

**Interfaces:** consumes createApplication, Zod schemas, and toPublicError. Produces createMcpServer(application: GamingDealsApplication): McpServer. Register exactly catalog_search, provider_sync_deterministic, deal_compare_product, deal_get_best_offer, deal_get_price_history, wishlist_create, wishlist_list, wishlist_update, and wishlist_remove. The CLI mcp command consumes it.

- [ ] **Step 1: Write failing MCP integration tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApplication } from '../../src/composition/root.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { createTemporaryDatabasePath } from '../helpers/temp-database.js';

describe('Gaming Deals MCP server', () => {
  test('syncs deterministic data then returns a safe best-offer result', async () => {
    const application = createApplication({
      databasePath: createTemporaryDatabasePath(), country: 'CO', comparisonCurrency: 'COP',
    });
    const server = createMcpServer(application);
    const client = new Client({ name: 'gaming-deals-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('deal_get_best_offer');
    const sync = await client.callTool({
      name: 'provider_sync_deterministic', arguments: { observedAt: '2026-08-30T00:00:00.000Z' },
    });
    expect(sync.isError).not.toBe(true);
    const result = await client.callTool({
      name: 'deal_get_best_offer', arguments: { productVariantId: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c' },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toContain('C:\\\\Users\\\\');
    expect(JSON.stringify(result)).not.toContain('secret-value');
    await client.close();
    await server.close();
    application.close();
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm vitest run tests/mcp/server.test.ts

Expected: FAIL because src/mcp/server.ts does not exist.

- [ ] **Step 3: Implement MCP boundary behavior**

Every registerTool call has a Zod inputSchema, calls exactly one application service, and returns structuredContent plus one JSON text content item. On any error, tool-results.ts converts via toPublicError and returns isError: true plus only code/message JSON. deal_compare_product and deal_get_best_offer input is { productVariantId: z.string().uuid() }; provider_sync_deterministic input is { observedAt: z.string().datetime() }; wishlist input derives from wishlistEntrySchema.

No handler reads process.env, executes SQL, or invokes provider sync payload parsing. Use the MCP SDK stdio-compatible server API, but only main.ts connects transport.

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/mcp/server.test.ts
pnpm typecheck
~~~

Expected: sync -> compare integration passes; malformed input fails at the MCP Zod boundary; safe errors never include secrets or paths.

- [ ] **Step 5: REFACTOR, evidence, and commit**

Centralize success/error result construction in tool-results.ts; do not centralize application behavior in tools. Runtime evidence: pnpm vitest run tests/mcp/server.test.ts --reporter=verbose passes. Rollback: remove src/mcp and its test only; applications remain available to CLI.

~~~bash
git add src/mcp tests/mcp/server.test.ts
git commit -m "feat(mcp): expose catalog offers and wishlist tools"
~~~

### Task 8: Add CLI entry points and bounded doctor diagnostics

**Files:** Create src/cli/doctor.ts and src/cli/main.ts. Test tests/cli/doctor.test.ts and tests/cli/main.test.ts.

**Interfaces:**
~~~ts
export async function runDoctor(input: {
  environment: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
}): Promise<'healthy' | 'unhealthy'>;

export async function runCli(
  argv: string[],
  environment: NodeJS.ProcessEnv,
  stdout: (line: string) => void,
): Promise<number>;
~~~

- [ ] **Step 1: Write failing CLI tests**

~~~ts
import { describe, expect, test } from 'vitest';
import { runDoctor } from '../../src/cli/doctor.js';

describe('runDoctor', () => {
  test('reports a healthy runtime without secrets or database paths', async () => {
    const lines: string[] = [];
    const result = await runDoctor({
      environment: {
        GAMING_DEALS_DATABASE_PATH: 'C:/Users/private/gaming-deals.sqlite',
        GAMING_DEALS_PROVIDER_API_KEY: 'secret-value',
      },
      stdout: (line) => lines.push(line),
    });
    expect(result).toBe('healthy');
    expect(lines.join('\n')).toContain('configuration: healthy');
    expect(lines.join('\n')).toContain('sqlite: writable');
    expect(lines.join('\n')).not.toContain('secret-value');
    expect(lines.join('\n')).not.toContain('C:/Users/private');
  });

  test('reports invalid configuration as a bounded failure', async () => {
    const lines: string[] = [];
    const result = await runDoctor({
      environment: { GAMING_DEALS_COMPARISON_CURRENCY: 'COPP' },
      stdout: (line) => lines.push(line),
    });
    expect(result).toBe('unhealthy');
    expect(lines).toEqual(['configuration: unhealthy (invalid_configuration)']);
  });
});
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm vitest run tests/cli/doctor.test.ts tests/cli/main.test.ts

Expected: FAIL because CLI modules do not exist.

- [ ] **Step 3: Implement CLI and doctor**

runDoctor checks exactly in order: configuration parse; openDatabase and readable migration metadata; a write/read/delete probe in one transaction; valid DeterministicDealProvider capability and parsed sync output. It prints only configuration, sqlite, migrations, deterministic_provider safe status lines. On configuration failure it prints exactly configuration: unhealthy (invalid_configuration), returns unhealthy, and makes no database call. Every other failure emits check: unhealthy (code) using toPublicError, never error.message.

runCli supports doctor and mcp. Unknown commands print Usage: gaming-deals <doctor|mcp> and return 2. mcp composes the application and connects createMcpServer to StdioServerTransport.

- [ ] **Step 4: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/cli/doctor.test.ts tests/cli/main.test.ts
pnpm build
pnpm doctor
~~~

Expected: tests pass, build emits dist, and doctor reports healthy safe status lines.

- [ ] **Step 5: REFACTOR, evidence, and commit**

Keep stream transport in main.ts and checks in doctor.ts. Re-run Step 4. Runtime evidence: pnpm doctor; pnpm test; pnpm typecheck all exit 0. Rollback: revert Task 8 CLI files/tests only.

~~~bash
git add src/cli tests/cli
git commit -m "feat(cli): add safe doctor diagnostics"
~~~

### Task 9: Complete the first real-provider gate without weakening the deterministic path

**Files:** Create docs/providers/cheapshark-onboarding.md. Only after gate success create src/providers/real/cheapshark-provider.ts and tests/providers/cheapshark-provider.test.ts, then modify src/composition/root.ts and src/cli/doctor.ts.

**Interfaces:** consumes DealProvider, normalizedProviderSyncSchema, PublicError, and configuration. Produces class CheapSharkDealProvider implements DealProvider only after evidence verifies permission and Colombia coverage. The adapter remains disabled by default unless evidence explicitly supports default operation.

- [ ] **Step 1: Write the onboarding evidence document first**

Create docs/providers/cheapshark-onboarding.md with this exact structure:

~~~markdown
# CheapShark provider onboarding record

| Gate | Evidence URL or retained response date | Result |
|---|---|---|
| Access mechanism | No current first-party evidence recorded | unverified |
| Authentication model | No current first-party evidence recorded | unverified |
| Permitted use for this public self-hosted comparator | No current first-party evidence recorded | unverified |
| Rate limits and polling rules | No current first-party evidence recorded | unverified |
| Colombia coverage | No current first-party evidence recorded | unverified |
| Available offer fields | No current first-party evidence recorded | unverified |
| Attribution or affiliate requirements | No current first-party evidence recorded | unverified |
| Automated comparison permission | No current first-party evidence recorded | unverified |
| Failure behavior | No current first-party evidence recorded | unverified |

## Decision

enabledByDefault: false

The adapter cannot be added or enabled until every row is verified as pass. A failed or unavailable gate leaves the deterministic provider unchanged and the real adapter absent.
~~~

- [ ] **Step 2: Verify RED**

Run: pnpm test

Expected: existing tests PASS. This documentation-only gate intentionally adds no production behavior before permission and coverage evidence is present.

- [ ] **Step 3: Obtain current evidence and make the gate decision**

Verify every row from first-party provider documents or explicit written approval; record an evidence URL/date and pass, fail, or unverified. Do not use a blog, code sample, undocumented endpoint, reverse-engineered endpoint, browser automation, stored password, captcha bypass, or inference from a public web page.

If every row is pass, proceed to Step 4. If any row is fail or unverified, leave enabledByDefault false, do not create the adapter, commit only the document, and report acceptance criterion 11 blocked by external permission/coverage evidence.

- [ ] **Step 4: After a pass decision, write a failing contract test**

~~~ts
import { describe, expect, test } from 'vitest';
import { normalizedProviderSyncSchema } from '../../src/domain/providers/contracts.js';
import { CheapSharkDealProvider } from '../../src/providers/real/cheapshark-provider.js';

describe('CheapSharkDealProvider', () => {
  test('normalizes a recorded permitted response without raw-source leakage', async () => {
    const provider = new CheapSharkDealProvider({
      fetch: async () => new Response(JSON.stringify({
        gameID: '612', title: 'Example Game', salePrice: '9.99',
        normalPrice: '19.99', dealRating: '9.0',
      }), { status: 200 }),
    });
    const output = await provider.sync({
      country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z',
    });
    expect(normalizedProviderSyncSchema.safeParse(output).success).toBe(true);
    expect(JSON.stringify(output)).not.toContain('dealRating');
  });
});
~~~

- [ ] **Step 5: Verify RED**

Run: pnpm vitest run tests/providers/cheapshark-provider.test.ts

Expected: FAIL because the real adapter does not exist.

- [ ] **Step 6: Implement the smallest compliant adapter after gate pass**

Inject fetch; set AbortSignal.timeout(5_000); map timeout/non-2xx/schema failure to PublicError provider_unavailable/Provider unavailable or provider_data_invalid/Provider data is invalid. Transform only documented fields through normalizedProviderSyncSchema; preserve retailer class/confidence from evidence and raw price/currency; mark region unknown unless the provider documents CO eligibility; do not emit raw response data. Do not add a provider-specific application path.

- [ ] **Step 7: Verify GREEN**

Run:
~~~powershell
pnpm vitest run tests/providers/cheapshark-provider.test.ts
pnpm test
pnpm typecheck
pnpm doctor
~~~

Expected: adapter uses the shared ingestion contract; public output never leaks credentials, raw payload, source URL, or provider errors.

- [ ] **Step 8: REFACTOR, evidence, and commit**

Keep HTTP parsing in the adapter and domain normalization at its boundary. Re-run Step 7. Runtime evidence: pnpm vitest run tests/providers/cheapshark-provider.test.ts --reporter=verbose passes.

Gate-passed commit:
~~~bash
git add docs/providers/cheapshark-onboarding.md src/providers/real/cheapshark-provider.ts tests/providers/cheapshark-provider.test.ts src/composition/root.ts src/cli/doctor.ts
git commit -m "feat(providers): add gated CheapShark adapter"
~~~

Gate-failed commit:
~~~bash
git add docs/providers/cheapshark-onboarding.md
git commit -m "docs(providers): record real provider gate status"
~~~

Rollback boundary: revert adapter, registration, doctor change, test, and onboarding record together; deterministic sync stays working.

## Acceptance coverage

| Acceptance criterion | Task evidence |
|---|---|
| Node/pnpm install with CO/COP defaults | 1: engines, config tests, pnpm install |
| Migration/reopen safety | 2: temporary real SQLite restart and future-version test |
| Idempotent deterministic sync/observations | 4 and 6: replay observation count is zero |
| MCP catalog and exact product variant | 6 and 7: registered tool integration |
| Best eligible offer and explanation | 5, 6, 7: pricing and MCP tests |
| Incompatible/ambiguous cannot win | 4 and 5: fixture and ranking tests |
| Original versus normalized amounts distinguishable | 3, 5, 6: Money fields and persistence assertions |
| History survives restart | 2 and 6: reopen/read real database |
| Wishlist CRUD survives restart | 6: create/reopen/list/update/remove tests |
| Safe doctor healthy/failure states | 8: CLI output tests |
| First real provider passes documented gate | 9: completed evidence table and shared-path adapter test |
| All required test layers pass | 1-9: pnpm test, typecheck, build, doctor |

## Final verification

Run from the repository root:

~~~powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm doctor
git diff --check
git status --short
~~~

Expected: Node >=22.13.0, pnpm >=10.0.0, all Vitest layers pass, TypeScript builds/typechecks, doctor produces safe output, and git diff --check has no whitespace errors.

## Risks and decisions requiring evidence

- A real provider cannot be considered complete until current first-party terms, permission, CO coverage, rate limit, attribution, and failure behavior are all recorded as pass. Do not enable a provider merely to satisfy a test.
- Node sqlite selects a >=22.13.0 engine floor because earlier Node 22 versions require an experimental flag.
- DatabaseSync is acceptable for this local Phase 1 flow only while transactions remain bounded and never contain network I/O.
- After release, add a new migration rather than changing a checksummed migration.
- All public adapters map errors to stable envelopes; internal causes remain internal.

## Execution handoff

Plan saved to docs/superpowers/plans/2026-08-30-phase-1-foundation.md. Execute task-by-task with a fresh review after every work unit and preserve the five PR slices.

## Key Learnings:

1. Node node:sqlite supports the project without an experimental flag only from Node 22.13.0 onward, so the plan sets that as the actual engine floor.
2. Monetary values use minor-unit integers so original and normalized currency values remain exact and distinguishable.
3. A real provider stays disabled and absent until its evidence gate proves permitted use and Colombia coverage.
