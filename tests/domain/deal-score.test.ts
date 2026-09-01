import { describe, expect, test } from 'vitest';
import {
  DEAL_SCORE_V1_CONSTANTS,
  DealScoreV1Policy,
  verdictFor,
  type DealScoreCandidate,
} from '../../src/domain/recommendations/deal-score.js';

const ids = {
  wishlist: '00000000-0000-4000-8000-000000000001',
  variant: '00000000-0000-4000-8000-000000000002',
  edition: '00000000-0000-4000-8000-000000000003',
  offer: '00000000-0000-4000-8000-000000000004',
  listing: '00000000-0000-4000-8000-000000000005',
  access: '00000000-0000-4000-8000-000000000006',
};
const evaluatedAt = '2026-09-01T12:00:00.000Z';
const policy = new DealScoreV1Policy();

function candidate(overrides: Partial<DealScoreCandidate> = {}): DealScoreCandidate {
  return {
    wishlistEntry: {
      id: ids.wishlist,
      productVariantId: ids.variant,
      priority: 3,
      targetPrice: { amountMinor: 10_000, currency: 'COP' },
      notes: null,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    },
    productVariant: {
      id: ids.variant,
      editionId: ids.edition,
      platform: 'pc',
      distribution: 'digital_storefront',
      regionCode: 'CO',
    },
    offer: {
      id: ids.offer,
      providerListingId: ids.listing,
      sourceObservationKey: 'listing-1',
      originalPrice: { amountMinor: 10_000, currency: 'COP' },
      normalizedPrice: { amountMinor: 10_000, currency: 'COP' },
      normalizedFinalPrice: { amountMinor: 10_000, currency: 'COP' },
      exchangeRateSource: 'identity',
      convertedAt: evaluatedAt,
      regionStatus: 'compatible',
      retailerClass: 'first_party_storefront',
      sourceConfidence: 'high',
      shippingKnown: true,
      taxesKnown: true,
      destinationUrl: 'https://example.test/deal',
      observedAt: evaluatedAt,
    },
    historicalLow: { amountMinor: 10_000, currency: 'COP' },
    purchaseAccess: { kind: 'none', activeRecords: [] },
    evaluatedAt,
    comparisonCurrency: 'COP',
    ...overrides,
  };
}

describe('verdictFor', () => {
  test.each([[0, 'skip'], [19, 'skip'], [20, 'wait'], [39, 'wait'], [40, 'neutral'], [59, 'neutral'], [60, 'good_deal'], [74, 'good_deal'], [75, 'buy'], [89, 'buy'], [90, 'exceptional_buy']] as const)(
    'maps score %i to %s', (score, verdict) => expect(verdictFor(score)).toBe(verdict),
  );
});

describe('DealScoreV1Policy', () => {
  test.each([
    ['at or below historical low', 10_000, { amountMinor: 10_000, currency: 'COP' }, 40],
    ['within five percent above historical low', 10_500, { amountMinor: 10_000, currency: 'COP' }, 30],
    ['within fifteen percent above historical low', 11_500, { amountMinor: 10_000, currency: 'COP' }, 20],
    ['more than fifteen percent above historical low', 11_501, { amountMinor: 10_000, currency: 'COP' }, 10],
    ['without comparable history', 10_000, null, 10],
  ] as const)('assigns the applicable price-history band for %s', (_name, amountMinor, historicalLow, points) => {
    const result = policy.evaluate(candidate({
      offer: { ...candidate().offer, normalizedFinalPrice: { amountMinor, currency: 'COP' } },
      historicalLow,
    }));
    expect(result.contributions[0]).toMatchObject({ factor: 'price_history', points });
  });

  test('awards the historical-low band when the final price is below the low', () => {
    const result = policy.evaluate(candidate({
      offer: { ...candidate().offer, normalizedFinalPrice: { amountMinor: 9_999, currency: 'COP' } },
    }));
    expect(result.contributions[0]).toMatchObject({ factor: 'price_history', points: 40 });
  });

  test('treats historical price in another currency as unavailable', () => {
    const result = policy.evaluate(candidate({ historicalLow: { amountMinor: 1, currency: 'USD' } }));
    expect(result.contributions[0]).toEqual({
      factor: 'price_history', points: 10, rationale: 'No comparable price history is available.',
    });
  });

  test.each([[1, 5], [2, 15], [3, 25]] as const)('assigns the fixed points for priority %i', (priority, points) => {
    expect(policy.evaluate(candidate({ wishlistEntry: { ...candidate().wishlistEntry, priority } })).contributions[1])
      .toMatchObject({ factor: 'wishlist_priority', points });
  });

  test.each([
    ['at target', 10_000, { amountMinor: 10_000, currency: 'COP' }, 20],
    ['within ten percent over target', 11_000, { amountMinor: 10_000, currency: 'COP' }, 10],
    ['outside ten percent over target', 11_001, { amountMinor: 10_000, currency: 'COP' }, 0],
  ] as const)('assigns the applicable target-price band for %s', (_name, amountMinor, targetPrice, points) => {
    const result = policy.evaluate(candidate({
      offer: { ...candidate().offer, normalizedFinalPrice: { amountMinor, currency: 'COP' } },
      wishlistEntry: { ...candidate().wishlistEntry, targetPrice },
    }));
    expect(result.contributions[2]).toMatchObject({ factor: 'target_price', points });
  });

  test('awards zero target-price points with a stable rationale when currencies differ', () => {
    const result = policy.evaluate(candidate({
      wishlistEntry: { ...candidate().wishlistEntry, targetPrice: { amountMinor: 10_000, currency: 'USD' } },
    }));
    expect(result.contributions[2]).toEqual({
      factor: 'target_price', points: 0,
      rationale: 'Target price is in USD, not comparison currency COP.',
    });
  });

  test('awards zero target-price points when no target is set', () => {
    const result = policy.evaluate(candidate({ wishlistEntry: { ...candidate().wishlistEntry, targetPrice: null } }));
    expect(result.contributions[2]).toEqual({ factor: 'target_price', points: 0, rationale: 'No target price is set.' });
  });

  test.each([['high', 5], ['medium', 3], ['low', 1]] as const)('assigns the fixed points for %s confidence', (confidence, points) => {
    const result = policy.evaluate(candidate({ offer: { ...candidate().offer, sourceConfidence: confidence } }));
    expect(result.contributions[3]).toMatchObject({ factor: 'source_confidence', points });
  });

  test.each([
    ['first_party_storefront', 5], ['authorized_store', 4], ['physical_retailer', 3], ['marketplace', 1],
  ] as const)('assigns the fixed points for %s', (retailerClass, points) => {
    const result = policy.evaluate(candidate({ offer: { ...candidate().offer, retailerClass } }));
    expect(result.contributions[4]).toMatchObject({ factor: 'retailer_class', points });
  });

  test.each([
    ['within 24 hours', '2026-08-31T12:00:00.000Z', 5],
    ['within 72 hours', '2026-08-29T12:00:00.000Z', 3],
    ['older than 72 hours', '2026-08-29T11:59:59.999Z', 0],
  ] as const)('assigns the applicable freshness band for %s', (_name, observedAt, points) => {
    const result = policy.evaluate(candidate({ offer: { ...candidate().offer, observedAt } }));
    expect(result.contributions[5]).toMatchObject({ factor: 'freshness', points });
  });

  test('applies exactly one visible -45 temporary-access contribution', () => {
    const withLoanAndSubscription = candidate({ purchaseAccess: {
      kind: 'temporary_access',
      activeRecords: [
        { id: ids.access, productVariantId: ids.variant, state: 'loan', provenance: 'manual', activeFrom: null, activeUntil: null, createdAt: evaluatedAt, updatedAt: evaluatedAt },
        { id: '00000000-0000-4000-8000-000000000007', productVariantId: ids.variant, state: 'subscription_access', provenance: 'manual', activeFrom: null, activeUntil: null, createdAt: evaluatedAt, updatedAt: evaluatedAt },
      ],
    } });
    expect(policy.evaluate(withLoanAndSubscription).contributions.filter(({ factor }) => factor === 'temporary_access'))
      .toEqual([expect.objectContaining({ points: -45 })]);
  });

  test('rejects owned candidates as a service-boundary invariant', () => {
    expect(() => policy.evaluate(candidate({ purchaseAccess: {
      kind: 'owned', activeRecords: [{ id: ids.access, productVariantId: ids.variant, state: 'owned', provenance: 'manual', activeFrom: null, activeUntil: null, createdAt: evaluatedAt, updatedAt: evaluatedAt }],
    } }))).toThrow('Owned candidates must be excluded before deal scoring');
  });

  test.each([
    ['missing', null],
    ['wrong-currency', { amountMinor: 10_000, currency: 'USD' }],
  ] as const)('rejects a %s normalized final price before scoring', (_name, normalizedFinalPrice) => {
    expect(() => policy.evaluate(candidate({ offer: { ...candidate().offer, normalizedFinalPrice } })))
      .toThrow('A reliable COP final price is required before deal scoring');
  });

  test('uses safe integer minor units at the largest supported value', () => {
    const amountMinor = Number.MAX_SAFE_INTEGER;
    const result = policy.evaluate(candidate({
      offer: { ...candidate().offer, normalizedFinalPrice: { amountMinor, currency: 'COP' } },
      historicalLow: { amountMinor, currency: 'COP' },
      wishlistEntry: { ...candidate().wishlistEntry, targetPrice: { amountMinor, currency: 'COP' } },
    }));
    expect(result.score).toBe(100);
  });

  test('rejects unsafe integer minor units before scoring', () => {
    expect(() => policy.evaluate(candidate({
      offer: {
        ...candidate().offer,
        normalizedFinalPrice: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'COP' },
      },
    }))).toThrow('Minor-unit amount must be a safe integer');
  });

  test('snapshots injected constants so post-construction mutation cannot affect scoring', () => {
    const injected = {
      ...DEAL_SCORE_V1_CONSTANTS,
      priority: { ...DEAL_SCORE_V1_CONSTANTS.priority, 3: 7 },
    };
    const injectedPolicy = new DealScoreV1Policy(injected);
    injected.priority[3] = 99;
    expect(injectedPolicy.evaluate(candidate()).contributions[1]).toMatchObject({ points: 7 });
  });

  test('deep-freezes canonical constants and preserves their score behavior', () => {
    expect(Object.isFrozen(DEAL_SCORE_V1_CONSTANTS)).toBe(true);
    expect(Object.isFrozen(DEAL_SCORE_V1_CONSTANTS.priceHistory)).toBe(true);
    expect(Reflect.set(DEAL_SCORE_V1_CONSTANTS.priority, 3, 99)).toBe(false);
    expect(policy.evaluate(candidate()).contributions[1]).toMatchObject({ points: 25 });
  });

  test('clamps scores at 0 and 100', () => {
    const high = policy.evaluate(candidate());
    const low = policy.evaluate(candidate({
      wishlistEntry: { ...candidate().wishlistEntry, priority: 1, targetPrice: null },
      historicalLow: null,
      offer: { ...candidate().offer, sourceConfidence: 'low', retailerClass: 'marketplace', observedAt: '2026-08-20T00:00:00.000Z' },
      purchaseAccess: { kind: 'temporary_access', activeRecords: [{ id: ids.access, productVariantId: ids.variant, state: 'loan', provenance: 'manual', activeFrom: null, activeUntil: null, createdAt: evaluatedAt, updatedAt: evaluatedAt }] },
    }));
    expect(high.score).toBe(100);
    expect(low.score).toBe(0);
  });

  test('keeps contributions ordered, partitions signed factors, and explains the result', () => {
    const result = policy.evaluate(candidate({ purchaseAccess: {
      kind: 'temporary_access', activeRecords: [{ id: ids.access, productVariantId: ids.variant, state: 'loan', provenance: 'manual', activeFrom: null, activeUntil: null, createdAt: evaluatedAt, updatedAt: evaluatedAt }],
    } }));
    expect(result.contributions.map(({ factor }) => factor)).toEqual([
      'price_history', 'wishlist_priority', 'target_price', 'source_confidence', 'retailer_class', 'freshness', 'temporary_access',
    ]);
    expect(result.positiveFactors.every(({ points }) => points > 0)).toBe(true);
    expect(result.negativeFactors).toEqual([expect.objectContaining({ factor: 'temporary_access', points: -45 })]);
    expect(result.explanation).toContain('Deal score: 55/100 (neutral).');
    expect(result.explanation).toContain('Temporary access is active.');
    const rationaleIndexes = result.contributions.map(({ rationale }) => result.explanation.indexOf(rationale));
    expect(rationaleIndexes).toEqual([...rationaleIndexes].sort((left, right) => left - right));
  });

  test('returns deeply immutable, non-aliased factor views', () => {
    const result = policy.evaluate(candidate({ purchaseAccess: {
      kind: 'temporary_access', activeRecords: [{ id: ids.access, productVariantId: ids.variant, state: 'loan', provenance: 'manual', activeFrom: null, activeUntil: null, createdAt: evaluatedAt, updatedAt: evaluatedAt }],
    } }));
    const originalContribution = result.contributions[0]!;
    const originalExplanation = result.explanation;

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.contributions)).toBe(true);
    expect(Object.isFrozen(result.positiveFactors)).toBe(true);
    expect(result.contributions[0]).not.toBe(result.positiveFactors[0]);
    expect(Reflect.set(result.positiveFactors[0]!, 'points', -999)).toBe(false);
    expect(Reflect.set(result.contributions, 0, { factor: 'changed', points: 0, rationale: 'changed' })).toBe(false);
    expect(result.contributions[0]).toEqual(originalContribution);
    expect(result.explanation).toBe(originalExplanation);
  });
});
