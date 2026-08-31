import { describe, expect, test } from 'vitest';
import type { CatalogEntry } from '../../src/domain/catalog/types.js';
import type { Offer, PriceObservation, ProviderListing } from '../../src/domain/offers/types.js';
import { PublicError } from '../../src/errors/public-error.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import {
  createSqliteTransactionRunner,
  SqliteCatalogRepository,
  SqliteOfferRepository,
  SqliteWishlistRepository,
} from '../../src/persistence/sqlite/repositories.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

describe('SQLite repositories', () => {
  test('round-trips non-null and null Task 3 fields through the asynchronous ports', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const offers = new SqliteOfferRepository(opened.database, 'CO');
      const fixture = createDeterministicSyncFixture();
      fixture.catalog[1]!.productVariant.regionCode = null;
      fixture.offers[1]!.normalizedPrice = null;
      fixture.offers[1]!.normalizedFinalPrice = null;
      fixture.offers[1]!.exchangeRateSource = null;
      fixture.offers[1]!.convertedAt = null;

      await persistFixture(catalog, offers, fixture.catalog, fixture.listings, fixture.offers);

      expect(await catalog.findProductVariant(fixture.catalog[0]!.productVariant.id)).toEqual(fixture.catalog[0]!.productVariant);
      expect(await catalog.findProductVariant(fixture.catalog[1]!.productVariant.id)).toEqual(fixture.catalog[1]!.productVariant);
      expect(await offers.listOffers(fixture.catalog[0]!.productVariant.id)).toEqual([fixture.offers[0]]);
      expect(await offers.listOffers(fixture.catalog[1]!.productVariant.id)).toEqual([fixture.offers[1]]);
      expect(await offers.listPriceHistory(fixture.catalog[1]!.productVariant.id))
        .toEqual([observationFor(fixture.offers[1]!, 2)]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('updates current values but never mutates an existing observation replay', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const offers = new SqliteOfferRepository(opened.database, 'CO');
      const fixture = createDeterministicSyncFixture();
      const entry = fixture.catalog[0]!;
      const listing = fixture.listings[0]!;
      const original = fixture.offers[0]!;
      const originalObservation = observationFor(original, 1);

      await catalog.upsertCatalog(entry);
      await offers.upsertListing(listing);
      await offers.upsertCurrentOffer(original);
      expect(await offers.appendPriceObservation(originalObservation)).toBe('inserted');

      const replay = structuredClone(original);
      replay.originalPrice.amountMinor = 4_000_000;
      replay.normalizedPrice!.amountMinor = 4_000_000;
      replay.normalizedFinalPrice!.amountMinor = 4_000_000;
      await offers.upsertCurrentOffer(replay);

      expect(await offers.appendPriceObservation(observationFor(replay, 1))).toBe('already_exists');
      expect(await offers.listOffers(entry.productVariant.id)).toEqual([replay]);
      expect(await offers.listPriceHistory(entry.productVariant.id)).toEqual([originalObservation]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('isolates caller-owned inputs and every returned object from persistent state', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const offers = new SqliteOfferRepository(opened.database, 'CO');
      const wishlist = new SqliteWishlistRepository(opened.database);
      const fixture = createDeterministicSyncFixture();
      const original = structuredClone(fixture);
      await persistFixture(catalog, offers, fixture.catalog, fixture.listings, fixture.offers);
      const wishlistInput = {
        id: '00000000-0000-4000-8000-000000000090',
        productVariantId: original.catalog[0]!.productVariant.id,
        priority: 1 as const,
        targetPrice: { amountMinor: 3_500_000, currency: 'COP' },
        notes: 'persistent', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
      };
      await wishlist.create(wishlistInput);

      fixture.catalog[0]!.productVariant.regionCode = 'mutated-input';
      fixture.offers[0]!.originalPrice.amountMinor = 1;
      fixture.offers[0]!.normalizedPrice!.amountMinor = 1;
      wishlistInput.targetPrice.amountMinor = 1;

      const catalogResult = await catalog.search('cobalt');
      const offerResult = await offers.listOffers(original.catalog[0]!.productVariant.id);
      const historyResult = await offers.listPriceHistory(original.catalog[0]!.productVariant.id);
      const wishlistResult = await wishlist.list();
      catalogResult[0]!.regionCode = 'mutated-output';
      offerResult[0]!.originalPrice.amountMinor = 2;
      offerResult[0]!.normalizedPrice!.amountMinor = 2;
      historyResult[0]!.originalPrice.amountMinor = 2;
      historyResult[0]!.normalizedPrice!.amountMinor = 2;
      wishlistResult[0]!.targetPrice!.amountMinor = 2;

      expect(await catalog.search('cobalt')).toEqual([original.catalog[0]!.productVariant]);
      expect(await offers.listOffers(original.catalog[0]!.productVariant.id)).toEqual([original.offers[0]]);
      expect(await offers.listPriceHistory(original.catalog[0]!.productVariant.id))
        .toEqual([observationFor(original.offers[0]!, 1)]);
      expect(await wishlist.list()).toEqual([{ ...wishlistInput, targetPrice: { amountMinor: 3_500_000, currency: 'COP' } }]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('rejects nested transactions deterministically while leaving a caught outer transaction usable', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const runInTransaction = createSqliteTransactionRunner(opened.database);
      const fixture = createDeterministicSyncFixture();
      let nestedError: unknown;

      await runInTransaction(async () => {
        await catalog.upsertCatalog(fixture.catalog[0]!);
        try { await runInTransaction(async () => undefined); } catch (error) { nestedError = error; }
        await catalog.upsertCatalog(fixture.catalog[1]!);
      });

      expect(nestedError).toMatchObject<Partial<PublicError>>({
        code: 'persistence_failure', message: 'Nested storage transactions are not supported',
      });
      expect(await catalog.search('')).toHaveLength(2);

      await expect(runInTransaction(async () => {
        const changed = structuredClone(fixture.catalog[0]!);
        changed.productVariant.regionCode = 'rolled-back';
        await catalog.upsertCatalog(changed);
        await runInTransaction(async () => undefined);
      })).rejects.toMatchObject<Partial<PublicError>>({
        code: 'persistence_failure', message: 'Nested storage transactions are not supported',
      });
      expect(await catalog.findProductVariant(fixture.catalog[0]!.productVariant.id)).toEqual(fixture.catalog[0]!.productVariant);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('wishlist update and removal never create an unknown row', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    try {
      const repository = new SqliteWishlistRepository(opened.database);
      const unknown = {
        id: '00000000-0000-4000-8000-000000000099', productVariantId: '00000000-0000-4000-8000-000000000098',
        priority: 2 as const, targetPrice: null, notes: null,
        createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
      };
      expect(await repository.update(unknown)).toBeNull();
      expect(await repository.remove(unknown.id)).toBe(false);
      expect(await repository.list()).toEqual([]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });
});

async function persistFixture(
  catalogRepository: SqliteCatalogRepository,
  offerRepository: SqliteOfferRepository,
  catalog: CatalogEntry[], listings: ProviderListing[], offers: Offer[],
): Promise<void> {
  for (const entry of catalog) await catalogRepository.upsertCatalog(entry);
  for (const listing of listings) await offerRepository.upsertListing(listing);
  for (const [index, offer] of offers.entries()) {
    await offerRepository.upsertCurrentOffer(offer);
    await offerRepository.appendPriceObservation(observationFor(offer, index + 1));
  }
}

function observationFor(offer: Offer, index: number): PriceObservation {
  return {
    id: `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    offerId: offer.id, providerListingId: offer.providerListingId,
    sourceObservationKey: offer.sourceObservationKey,
    originalPrice: structuredClone(offer.originalPrice), normalizedPrice: structuredClone(offer.normalizedPrice),
    observedAt: offer.observedAt,
  };
}
