import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test, vi } from 'vitest';
import { AccessService } from '../../src/application/access-service.js';
import { OfferService } from '../../src/application/offer-service.js';
import { RecommendationService } from '../../src/application/recommendation-service.js';
import { syncProvider } from '../../src/application/sync-provider.js';
import { WishlistService } from '../../src/application/wishlist-service.js';
import type { DealScorePolicy } from '../../src/domain/recommendations/deal-score.js';
import { DealScoreV1Policy } from '../../src/domain/recommendations/deal-score.js';
import { PublicError } from '../../src/errors/public-error.js';
import { createApplication } from '../../src/composition/root.js';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import {
  createSqliteTransactionRunner,
  SqliteAccessRepository,
  SqliteCatalogRepository,
  SqliteOfferRepository,
  SqliteWishlistRepository,
} from '../../src/persistence/sqlite/repositories.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

const evaluatedAt = '2026-09-01T10:00:00.000Z';

describe('recommendation service', () => {
  test('returns empty arrays for an empty persisted wishlist after one access batch', async () => {
    const context = await createContext();
    const listByProductVariantIds = vi.spyOn(context.accessRepository, 'listByProductVariantIds');

    try {
      await expect(context.service.whatShouldIBuy()).resolves.toEqual({ recommendations: [], exclusions: [] });
      expect(listByProductVariantIds).toHaveBeenCalledTimes(1);
      expect(listByProductVariantIds).toHaveBeenCalledWith([]);
    } finally {
      context.close();
    }
  });

  test('ranks persisted wishlist entries only and batch-loads access once', async () => {
    const context = await createContext({ eligibleSecondVariant: true });
    const wishlistCandidate = await context.wishlistService.create(wishlistInput(context.variantIds[0]!));
    const listByProductVariantIds = vi.spyOn(context.accessRepository, 'listByProductVariantIds');

    try {
      const result = await context.service.whatShouldIBuy();

      expect(result.recommendations.map(({ productVariant }) => productVariant.id)).toEqual([wishlistCandidate.productVariantId]);
      expect(result.exclusions).toEqual([]);
      expect(listByProductVariantIds).toHaveBeenCalledTimes(1);
      expect(listByProductVariantIds).toHaveBeenCalledWith([wishlistCandidate.productVariantId]);
    } finally {
      context.close();
    }
  });

  test('turns inherited no-selected-offer blockers into wishlist exclusions', async () => {
    const context = await createContext();
    await context.wishlistService.create(wishlistInput(context.variantIds[1]!));

    try {
      await expect(context.service.whatShouldIBuy()).resolves.toEqual({
        recommendations: [],
        exclusions: [{ productVariantId: context.variantIds[1], blockers: ['Offer is incompatible with CO'] }],
      });
    } finally {
      context.close();
    }
  });

  test('uses the safe no-offer explanation when no per-offer blocker exists', async () => {
    const context = await createContext({ omitSecondOffer: true });
    await context.wishlistService.create(wishlistInput(context.variantIds[1]!));

    try {
      await expect(context.service.whatShouldIBuy()).resolves.toEqual({
        recommendations: [],
        exclusions: [{
          productVariantId: context.variantIds[1],
          blockers: ['No eligible verified offer is available for CO.'],
        }],
      });
    } finally {
      context.close();
    }
  });

  test('excludes owned but ranks temporary access with one -45 factor', async () => {
    const context = await createContext({ eligibleSecondVariant: true });
    const ownedVariantId = context.variantIds[0]!;
    const temporaryVariantId = context.variantIds[1]!;
    await context.wishlistService.create(wishlistInput(ownedVariantId));
    await context.wishlistService.create(wishlistInput(temporaryVariantId));
    await context.accessService.create(accessInput(ownedVariantId, 'owned'));
    await context.accessService.create(accessInput(temporaryVariantId, 'loan'));

    try {
      const result = await context.service.whatShouldIBuy();

      expect(result.exclusions).toContainEqual({ productVariantId: ownedVariantId, blockers: ['Product is already owned'] });
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0]).toMatchObject({
        productVariant: { id: temporaryVariantId },
        access: { kind: 'temporary_access' },
      });
      expect(result.recommendations[0]!.score.negativeFactors).toContainEqual(expect.objectContaining({
        factor: 'temporary_access', points: -45,
      }));
      expect(result.recommendations[0]!.score.negativeFactors.filter(({ factor }) => factor === 'temporary_access')).toHaveLength(1);
    } finally {
      context.close();
    }
  });

  test('keeps selected offer and active access context while expired access has no effect', async () => {
    const context = await createContext();
    const productVariantId = context.variantIds[0]!;
    await context.wishlistService.create(wishlistInput(productVariantId));
    await context.accessService.create({
      ...accessInput(productVariantId, 'owned'),
      activeUntil: '2026-08-31T23:59:59.999Z',
    });

    try {
      const result = await context.service.whatShouldIBuy();
      const recommendation = result.recommendations[0]!;

      expect(recommendation.selectedOffer).toEqual({ listing: context.fixture.listings[0], offer: context.fixture.offers[0] });
      expect(recommendation.access).toEqual({ kind: 'none', activeRecords: [] });
    } finally {
      context.close();
    }
  });

  test('uses the injected policy and sorts score, priority, then product-variant UUID', async () => {
    const policy: DealScorePolicy = {
      evaluate: vi.fn((candidate) => ({
        score: candidate.productVariant.id.endsWith('6d') ? 10 : 10,
        verdict: 'wait', contributions: [], positiveFactors: [], negativeFactors: [], explanation: 'test policy',
      })),
    };
    const context = await createContext({ eligibleSecondVariant: true, policy });
    const firstVariantId = context.variantIds[0]!;
    const secondVariantId = context.variantIds[1]!;
    await context.wishlistService.create(wishlistInput(secondVariantId, 2));
    await context.wishlistService.create(wishlistInput(firstVariantId, 2));

    try {
      const result = await context.service.whatShouldIBuy();

      expect(policy.evaluate).toHaveBeenCalledTimes(2);
      expect(result.recommendations.map(({ productVariant }) => productVariant.id)).toEqual([
        firstVariantId,
        secondVariantId,
      ]);
      expect((policy.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
        evaluatedAt,
        comparisonCurrency: 'COP',
      });
    } finally {
      context.close();
    }
  });

  test('exposes recommendation evaluation through the composition root with an injected clock', async () => {
    const temporary = createTemporaryDatabase();
    const application = createApplication({
      databasePath: temporary.path,
      country: 'CO',
      comparisonCurrency: 'COP',
      clock: () => '2026-08-30T00:00:00.000Z',
    });
    const fixture = createDeterministicSyncFixture();

    try {
      await application.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
      await application.createWishlistEntry(wishlistInput(fixture.catalog[0]!.productVariant.id));

      expect((await application.whatShouldIBuy()).recommendations[0]!.score.score).toBe(79);
    } finally {
      application.close();
      temporary.cleanup();
    }
  });

  test('maps direct repository failures to persistence_failure', async () => {
    const context = await createContext();
    context.opened.close();

    try {
      await expect(context.service.whatShouldIBuy()).rejects.toMatchObject<Partial<PublicError>>({
        code: 'persistence_failure', message: 'Persistent storage is unavailable',
      });
    } finally {
      context.temporary.cleanup();
    }
  });
});

async function createContext(input: { eligibleSecondVariant?: boolean; omitSecondOffer?: boolean; policy?: DealScorePolicy } = {}) {
  const temporary = createTemporaryDatabase();
  const opened = openDatabase(temporary.path);
  const catalogRepository = new SqliteCatalogRepository(opened.database);
  const offerRepository = new SqliteOfferRepository(opened.database, 'CO');
  const wishlistRepository = new SqliteWishlistRepository(opened.database);
  const accessRepository = new SqliteAccessRepository(opened.database);
  const fixture = createDeterministicSyncFixture();
  if (input.eligibleSecondVariant) fixture.offers[1]!.regionStatus = 'compatible';
  if (input.omitSecondOffer) fixture.offers.splice(1, 1);

  await syncProvider({
    provider: {
      capability: {
        providerId: 'deterministic', displayName: 'Deterministic', retailerClass: 'authorized_store',
        sourceConfidence: 'high', supportedCountries: ['CO'], authentication: 'none', enabledByDefault: true,
      },
      async sync() { return fixture; },
    },
    catalogRepository,
    offerRepository,
    runInTransaction: createSqliteTransactionRunner(opened.database),
    country: 'CO', comparisonCurrency: 'COP', observedAt: '2026-08-30T00:00:00.000Z',
  });

  const wishlistService = new WishlistService(wishlistRepository);
  const accessService = new AccessService(accessRepository, catalogRepository);
  const service = new RecommendationService({
    wishlistRepository,
    catalogRepository,
    accessRepository,
    offerService: new OfferService(catalogRepository, offerRepository, 'CO', 'COP'),
    policy: input.policy ?? new DealScoreV1Policy(),
    clock: () => evaluatedAt,
    comparisonCurrency: 'COP',
  });

  return {
    temporary, opened, fixture, service, wishlistService, accessService, accessRepository,
    variantIds: fixture.catalog.map(({ productVariant }) => productVariant.id),
    close: () => { opened.close(); temporary.cleanup(); },
  };
}

function wishlistInput(productVariantId: string, priority: 1 | 2 | 3 = 3) {
  return {
    productVariantId, priority, targetPrice: null, notes: null,
    now: '2026-08-30T00:00:00.000Z',
  };
}

function accessInput(productVariantId: string, state: 'owned' | 'subscription_access' | 'loan') {
  return {
    productVariantId, state, provenance: 'manual' as const,
    activeFrom: null, activeUntil: null, now: '2026-08-30T00:00:00.000Z',
  };
}
