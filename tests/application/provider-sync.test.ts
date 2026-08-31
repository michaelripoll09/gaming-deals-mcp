import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { syncProvider } from '../../src/application/sync-provider.js';
import { createApplication } from '../../src/composition/root.js';
import type { DealProvider } from '../../src/domain/providers/contracts.js';
import { PublicError } from '../../src/errors/public-error.js';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import {
  createSqliteTransactionRunner,
  SqliteCatalogRepository,
  SqliteOfferRepository,
} from '../../src/persistence/sqlite/repositories.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

describe('provider synchronization', () => {
  test('does not append duplicate observations for the same replay', async () => {
    const temporary = createTemporaryDatabase();
    const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });
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
    let transactionCalls = 0;
    try {
      const context = sqliteSyncContext(opened.database, 'CO');
      const runInTransaction = async <T>(work: () => Promise<T>): Promise<T> => {
        transactionCalls += 1;
        return context.runInTransaction(work);
      };
      await expect(syncProvider({
        ...context,
        runInTransaction,
        provider: provider(async () => {
          syncCalls += 1;
          return { catalog: [], listings: [], offers: [], unexpected: true };
        }),
        country: 'CO', comparisonCurrency: 'COP', observedAt: '2026-08-30T00:00:00.000Z',
      })).rejects.toMatchObject<Partial<PublicError>>({
        code: 'provider_data_invalid', message: 'Provider data is invalid',
      });
      expect(syncCalls).toBe(1);
      expect(transactionCalls).toBe(0);
      expect(databaseSnapshot(opened.database).games).toEqual([]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('rejects an invalid capability before invoking the provider', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    let syncCalls = 0;
    let transactionCalls = 0;
    try {
      const context = sqliteSyncContext(opened.database, 'CO');
      const malformedProvider = {
        capability: { ...providerCapability(), supportedCountries: ['co'] },
        async sync() { syncCalls += 1; return createDeterministicSyncFixture(); },
      } as unknown as DealProvider;
      await expect(syncProvider({
        ...context,
        runInTransaction: async <T>(work: () => Promise<T>) => {
          transactionCalls += 1;
          return context.runInTransaction(work);
        },
        provider: malformedProvider,
        country: 'CO', comparisonCurrency: 'COP', observedAt: '2026-08-30T00:00:00.000Z',
      })).rejects.toMatchObject<Partial<PublicError>>({
        code: 'provider_data_invalid', message: 'Provider data is invalid',
      });
      expect(syncCalls).toBe(0);
      expect(transactionCalls).toBe(0);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('rejects an unsupported configured country without calling or persisting the provider', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    let syncCalls = 0;
    let transactionCalls = 0;
    try {
      const context = sqliteSyncContext(opened.database, 'US');
      await expect(syncProvider({
        ...context,
        runInTransaction: async <T>(work: () => Promise<T>) => {
          transactionCalls += 1;
          return context.runInTransaction(work);
        },
        provider: provider(async () => { syncCalls += 1; return createDeterministicSyncFixture(); }),
        country: 'US', comparisonCurrency: 'COP', observedAt: '2026-08-30T00:00:00.000Z',
      })).rejects.toMatchObject<Partial<PublicError>>({
        code: 'provider_data_invalid', message: 'Provider data is invalid',
      });
      expect(syncCalls).toBe(0);
      expect(transactionCalls).toBe(0);
      expect(databaseSnapshot(opened.database).games).toEqual([]);
      expect(await context.offerRepository.listOffers('10293847-5647-4a3b-8c2d-1e0f9a8b7c6d')).toEqual([]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('rejects a changed current Offer identity before mutating committed state', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    const fixture = createDeterministicSyncFixture();
    try {
      const context = sqliteSyncContext(opened.database, 'CO');
      await runSync(context, provider(async () => fixture));
      const before = databaseSnapshot(opened.database);
      const changedIdentity = structuredClone(fixture);
      changedIdentity.offers[0]!.id = '00000000-0000-4000-8000-000000000123';
      changedIdentity.offers[0]!.sourceObservationKey = 'deterministic:CO:COP:cobalt:2026-08-31';
      changedIdentity.offers[0]!.observedAt = '2026-08-31T00:00:00.000Z';

      await expect(runSync(context, provider(async () => changedIdentity), '2026-08-31T00:00:00.000Z'))
        .rejects.toMatchObject<Partial<PublicError>>({
          code: 'provider_data_invalid', message: 'Provider data is invalid',
        });
      expect(databaseSnapshot(opened.database)).toEqual(before);
      expect(await context.offerRepository.listPriceHistory(fixture.catalog[0]!.productVariant.id)).toHaveLength(1);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });

  test('rolls back exact pre-existing fields and relationships after a late storage failure', async () => {
    const temporary = createTemporaryDatabase();
    const opened = openDatabase(temporary.path);
    const fixture = createDeterministicSyncFixture();
    try {
      const context = sqliteSyncContext(opened.database, 'CO');
      await runSync(context, provider(async () => fixture));
      const before = databaseSnapshot(opened.database);
      const failingFixture = structuredClone(fixture);
      failingFixture.catalog[0]!.productVariant.regionCode = 'global';
      failingFixture.offers[0]!.sourceObservationKey = 'deterministic:CO:COP:cobalt:2026-08-31';
      failingFixture.offers[0]!.originalPrice.amountMinor = 1;
      failingFixture.offers[0]!.normalizedPrice!.amountMinor = 1;
      failingFixture.offers[0]!.normalizedFinalPrice!.amountMinor = 1;
      failingFixture.offers[0]!.observedAt = '2026-08-31T00:00:00.000Z';
      failingFixture.offers[2]!.exchangeRateSource = 'identity';
      failingFixture.offers[2]!.convertedAt = null;

      await expect(runSync(context, provider(async () => failingFixture), '2026-08-31T00:00:00.000Z'))
        .rejects.toMatchObject<Partial<PublicError>>({
          code: 'persistence_failure', message: 'Persistent storage is unavailable',
        });
      expect(databaseSnapshot(opened.database)).toEqual(before);
      expect(await context.catalogRepository.findProductVariant(fixture.catalog[0]!.productVariant.id))
        .toEqual(fixture.catalog[0]!.productVariant);
      expect(await context.offerRepository.listOffers(fixture.catalog[0]!.productVariant.id)).toEqual([fixture.offers[0]]);
    } finally {
      opened.close();
      temporary.cleanup();
    }
  });
});

function sqliteSyncContext(database: DatabaseSync, country: string) {
  return {
    catalogRepository: new SqliteCatalogRepository(database),
    offerRepository: new SqliteOfferRepository(database, country),
    runInTransaction: createSqliteTransactionRunner(database),
  };
}

async function runSync(
  context: ReturnType<typeof sqliteSyncContext>,
  dealProvider: DealProvider,
  observedAt = '2026-08-30T00:00:00.000Z',
) {
  return syncProvider({
    ...context, provider: dealProvider, country: 'CO', comparisonCurrency: 'COP', observedAt,
  });
}

function provider(sync: DealProvider['sync']): DealProvider {
  return { capability: providerCapability(), sync };
}

function providerCapability() {
  return {
    providerId: 'deterministic', displayName: 'Deterministic', retailerClass: 'authorized_store' as const,
    sourceConfidence: 'high' as const, supportedCountries: ['CO'], authentication: 'none' as const,
    enabledByDefault: true,
  };
}

function databaseSnapshot(database: DatabaseSync) {
  const table = (name: string) => database.prepare(`SELECT * FROM ${name} ORDER BY id`).all();
  return {
    games: table('games'), releases: table('releases'), editions: table('editions'),
    productVariants: table('product_variants'), listings: table('provider_listings'),
    offers: table('offers'), observations: table('price_observations'),
  };
}
