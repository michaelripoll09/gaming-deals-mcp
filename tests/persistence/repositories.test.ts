import { describe, expect, test } from 'vitest';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import {
  SqliteCatalogRepository,
  SqliteOfferRepository,
  SqliteTransactionManager,
  SqliteWishlistRepository,
} from '../../src/persistence/sqlite/repositories.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

describe('SQLite repositories', () => {
  test('round-trips every persisted offer field and appends immutable observations once', () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);

    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const offers = new SqliteOfferRepository(opened.database);
      const transaction = new SqliteTransactionManager(opened.database);
      const fixture = createDeterministicSyncFixture();

      const firstInserted = transaction.run(() => {
        catalog.upsert(fixture.catalog, fixture.offers[0]!.observedAt);
        offers.upsertListings(fixture.listings);
        return offers.upsertCurrentAndAppendObservations(fixture.offers, 'CO');
      });
      expect(offers.listCandidatesForProductVariant(fixture.catalog[0]!.productVariant.id, 'CO'))
        .toEqual([{
          listing: fixture.listings[0],
          offer: fixture.offers[0],
        }]);

      const replay = structuredClone(fixture.offers);
      replay[0]!.originalPrice.amountMinor = 4_000_000;
      replay[0]!.normalizedPrice!.amountMinor = 4_000_000;
      replay[0]!.normalizedFinalPrice!.amountMinor = 4_000_000;
      const secondInserted = transaction.run(() => {
        catalog.upsert(fixture.catalog, fixture.offers[0]!.observedAt);
        offers.upsertListings(fixture.listings);
        return offers.upsertCurrentAndAppendObservations(replay, 'CO');
      });

      expect(firstInserted).toBe(3);
      expect(secondInserted).toBe(0);
      expect(offers.listCandidatesForProductVariant(fixture.catalog[0]!.productVariant.id, 'CO'))
        .toEqual([{
          listing: fixture.listings[0],
          offer: replay[0],
        }]);
      expect(offers.listPriceHistory(fixture.catalog[0]!.productVariant.id))
        .toEqual([expect.objectContaining({
          offerId: fixture.offers[0]!.id,
          providerListingId: fixture.listings[0]!.id,
          sourceObservationKey: fixture.offers[0]!.sourceObservationKey,
          originalPrice: fixture.offers[0]!.originalPrice,
          normalizedPrice: fixture.offers[0]!.normalizedPrice,
          observedAt: fixture.offers[0]!.observedAt,
        })]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('rolls back every repository write when a transaction fails', () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);

    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const transaction = new SqliteTransactionManager(opened.database);
      const fixture = createDeterministicSyncFixture();
      const conflicting = structuredClone(fixture.catalog[0]!);
      conflicting.game.id = '00000000-0000-4000-8000-000000000001';

      expect(() => transaction.run(() => catalog.upsert(
        [fixture.catalog[0]!, conflicting],
        fixture.offers[0]!.observedAt,
      ))).toThrow();
      expect(opened.database.prepare('SELECT COUNT(*) AS count FROM games').get()).toEqual({ count: 0 });
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('wishlist update and removal never create an unknown row', () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);

    try {
      const repository = new SqliteWishlistRepository(opened.database);
      const unknown = {
        id: '00000000-0000-4000-8000-000000000099',
        productVariantId: '00000000-0000-4000-8000-000000000098',
        priority: 2 as const,
        targetPrice: null,
        notes: null,
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
      };

      expect(repository.update(unknown)).toBeNull();
      expect(repository.remove(unknown.id)).toBe(false);
      expect(repository.list()).toEqual([]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });
});
