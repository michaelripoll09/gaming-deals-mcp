import { describe, expect, test } from 'vitest';
import { PublicError } from '../../src/errors/public-error.js';
import { createApplication } from '../../src/composition/root.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import {
  SqliteCatalogRepository,
  SqliteOfferRepository,
  SqliteTransactionManager,
} from '../../src/persistence/sqlite/repositories.js';
import { syncProvider } from '../../src/application/sync-provider.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

describe('provider synchronization', () => {
  test('does not append duplicate observations for the same replay', async () => {
    const temporary = createTemporaryDatabase();
    const application = createApplication({
      databasePath: temporary.path,
      country: 'CO',
      comparisonCurrency: 'COP',
    });

    try {
      const first = await application.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
      const second = await application.syncDeterministicProvider('2026-08-30T00:00:00.000Z');

      expect(first).toEqual({ catalogCount: 2, listingCount: 3, offerCount: 3, observationCount: 3 });
      expect(second).toEqual({ catalogCount: 2, listingCount: 3, offerCount: 3, observationCount: 0 });
    } finally {
      application.close();
      temporary.cleanup();
    }
  });

  test('persists catalog, comparison, and immutable history across reopen', async () => {
    const temporary = createTemporaryDatabase();
    const fixture = createDeterministicSyncFixture();
    const first = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      await first.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
      first.close();

      const second = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });
      try {
        expect(await second.searchCatalog('cobalt')).toEqual([fixture.catalog[0]!.productVariant]);
        expect((await second.compareProductVariant(fixture.catalog[0]!.productVariant.id)).selected)
          .toEqual({ listing: fixture.listings[0], offer: fixture.offers[0] });
        expect(await second.listPriceHistory(fixture.catalog[0]!.productVariant.id))
          .toEqual([expect.objectContaining({
            offerId: fixture.offers[0]!.id,
            sourceObservationKey: fixture.offers[0]!.sourceObservationKey,
            normalizedPrice: fixture.offers[0]!.normalizedPrice,
          })]);
      } finally {
        second.close();
      }
    } finally {
      try { first.close(); } catch { /* already closed */ }
      temporary.cleanup();
    }
  });

  test('validates unknown provider output before opening a transaction', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    let syncCalls = 0;

    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const offers = new SqliteOfferRepository(opened.database);
      const transaction = new SqliteTransactionManager(opened.database);

      await expect(syncProvider({
        provider: {
          capability: {
            providerId: 'invalid', displayName: 'Invalid', retailerClass: 'marketplace',
            sourceConfidence: 'low', supportedCountries: ['CO'], authentication: 'none', enabledByDefault: true,
          },
          async sync() {
            syncCalls += 1;
            return { catalog: [], listings: [], offers: [], unexpected: true };
          },
        },
        catalogRepository: catalog,
        offerRepository: offers,
        transactionManager: transaction,
        country: 'CO',
        comparisonCurrency: 'COP',
        observedAt: '2026-08-30T00:00:00.000Z',
      })).rejects.toMatchObject<Partial<PublicError>>({
        code: 'provider_data_invalid', message: 'Provider data is invalid',
      });
      expect(syncCalls).toBe(1);
      expect(opened.database.prepare('SELECT COUNT(*) AS count FROM games').get()).toEqual({ count: 0 });
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('maps a transactional storage failure and preserves committed state', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    const fixture = createDeterministicSyncFixture();

    try {
      const catalog = new SqliteCatalogRepository(opened.database);
      const offers = new SqliteOfferRepository(opened.database);
      const transaction = new SqliteTransactionManager(opened.database);
      const validProvider = { capability: providerCapability(), async sync() { return fixture; } };
      await syncProvider({ provider: validProvider, catalogRepository: catalog, offerRepository: offers,
        transactionManager: transaction, country: 'CO', comparisonCurrency: 'COP',
        observedAt: '2026-08-30T00:00:00.000Z' });

      const conflictingFixture = structuredClone(fixture);
      conflictingFixture.catalog[1]!.game.id = '00000000-0000-4000-8000-000000000001';
      conflictingFixture.catalog[1]!.release.gameId = '00000000-0000-4000-8000-000000000001';
      const failingProvider = { capability: providerCapability(), async sync() { return conflictingFixture; } };

      await expect(syncProvider({ provider: failingProvider, catalogRepository: catalog, offerRepository: offers,
        transactionManager: transaction, country: 'CO', comparisonCurrency: 'COP',
        observedAt: '2026-08-31T00:00:00.000Z' })).rejects.toMatchObject<Partial<PublicError>>({
        code: 'persistence_failure', message: 'Persistent storage is unavailable',
      });
      expect(opened.database.prepare('SELECT COUNT(*) AS count FROM games').get()).toEqual({ count: 2 });
      expect(opened.database.prepare('SELECT COUNT(*) AS count FROM price_observations').get()).toEqual({ count: 3 });
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });
});

function providerCapability() {
  return {
    providerId: 'test', displayName: 'Test', retailerClass: 'authorized_store' as const,
    sourceConfidence: 'high' as const, supportedCountries: ['CO'], authentication: 'none' as const,
    enabledByDefault: true,
  };
}
