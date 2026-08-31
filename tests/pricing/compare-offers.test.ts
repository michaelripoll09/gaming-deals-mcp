import { describe, expect, test } from 'vitest';
import { evaluateEligibility } from '../../src/domain/pricing/eligibility.js';
import { selectBestOffer } from '../../src/domain/pricing/compare-offers.js';

const productVariant = {
  id: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
  editionId: '64b514cb-0e12-4e0c-97e5-da0e2c67dbe8',
  platform: 'pc' as const,
  distribution: 'digital_storefront' as const,
  regionCode: 'CO',
};

function candidate(input: {
  id: string;
  amountMinor?: number;
  mappingState?: 'verified' | 'probable' | 'ambiguous' | 'unmatched';
  regionStatus?: 'compatible' | 'incompatible' | 'unknown';
  finalCurrency?: string;
  finalPrice?: number | null;
  confidence?: 'high' | 'medium' | 'low';
  retailerClass?: 'authorized_store' | 'marketplace' | 'first_party_storefront' | 'physical_retailer';
  shippingKnown?: boolean;
  taxesKnown?: boolean;
}) {
  const amountMinor = input.amountMinor ?? 4_000_000;
  const listingId = `d0075e12-e721-4d0c-8ed4-${input.id}`;

  return {
    listing: {
      id: listingId,
      providerId: 'deterministic',
      providerProductId: input.id,
      productVariantId: productVariant.id,
      mappingState: input.mappingState ?? 'verified',
    },
    offer: {
      id: `6c86d8de-9f26-494f-9462-${input.id}`,
      providerListingId: listingId,
      sourceObservationKey: input.id,
      originalPrice: { amountMinor, currency: 'COP' },
      normalizedPrice: { amountMinor, currency: 'COP' },
      normalizedFinalPrice: input.finalPrice === null
        ? null
        : { amountMinor: input.finalPrice ?? amountMinor, currency: input.finalCurrency ?? 'COP' },
      exchangeRateSource: 'identity',
      convertedAt: '2026-08-30T00:00:00.000Z',
      regionStatus: input.regionStatus ?? 'compatible',
      retailerClass: input.retailerClass ?? 'authorized_store',
      sourceConfidence: input.confidence ?? 'high',
      shippingKnown: input.shippingKnown ?? true,
      taxesKnown: input.taxesKnown ?? true,
      destinationUrl: `https://example.test/${input.id}`,
      observedAt: '2026-08-30T00:00:00.000Z',
    },
  };
}

function select(candidates: ReturnType<typeof candidate>[]) {
  return selectBestOffer({
    productVariant,
    country: 'CO',
    comparisonCurrency: 'COP',
    history: [],
    candidates,
  });
}

describe('evaluateEligibility', () => {
  test('reports every hard blocker in rule order', () => {
    const rejected = candidate({
      id: '000000000001',
      mappingState: 'ambiguous',
      regionStatus: 'incompatible',
      finalPrice: null,
    });

    expect(evaluateEligibility({ ...rejected, country: 'CO', comparisonCurrency: 'COP' })).toEqual({
      eligible: false,
      blockers: [
        'Mapping is not verified',
        'Offer is incompatible with CO',
        'Reliable COP final price is unavailable',
      ],
      cautions: [],
    });
  });

  test('keeps unknown-region offers eligible with a caution', () => {
    const unknown = candidate({ id: '000000000002', regionStatus: 'unknown' });

    expect(evaluateEligibility({ ...unknown, country: 'CO', comparisonCurrency: 'COP' })).toEqual({
      eligible: true,
      blockers: [],
      cautions: ['Region compatibility is unknown'],
    });
  });
});

describe('selectBestOffer', () => {
  test('selects the lowest reliable final COP price with an explanation', () => {
    const result = select([candidate({ id: '000000000003', amountMinor: 4_000_000 })]);

    expect(result.selected?.offer.id).toBe('6c86d8de-9f26-494f-9462-000000000003');
    expect(result.positiveFactors).toContain('Verified mapping');
    expect(result.explanation).toContain('COP');
    expect(result.explanation).toContain(productVariant.id);
  });

  test('does not choose when no eligible verified candidate exists', () => {
    const result = select([]);

    expect(result.selected).toBeNull();
    expect(result.explanation).toBe('No eligible verified offer is available for CO.');
  });

  test('appends deterministic exclusions when every candidate is rejected', () => {
    const ambiguous = candidate({ id: '000000000016', mappingState: 'ambiguous' });
    const incompatible = candidate({ id: '000000000017', regionStatus: 'incompatible', finalPrice: null });

    const result = select([ambiguous, incompatible]);

    expect(result.selected).toBeNull();
    expect(result.explanation).toBe(
      `No eligible verified offer is available for CO. Exclusions: ${ambiguous.offer.id} (Mapping is not verified), ${incompatible.offer.id} (Offer is incompatible with CO; Reliable COP final price is unavailable).`,
    );
  });

  test('excludes unverified, incompatible, and unreliable-final-price candidates', () => {
    const safe = candidate({ id: '000000000004', amountMinor: 4_000_000 });
    const ambiguous = candidate({ id: '000000000005', amountMinor: 1, mappingState: 'ambiguous' });
    const incompatible = candidate({ id: '000000000006', amountMinor: 1, regionStatus: 'incompatible' });
    const missingFinal = candidate({ id: '000000000007', amountMinor: 1, finalPrice: null });
    const wrongFinalCurrency = candidate({ id: '000000000008', amountMinor: 1, finalCurrency: 'USD' });

    const result = select([ambiguous, incompatible, missingFinal, wrongFinalCurrency, safe]);

    expect(result.selected?.offer.id).toBe(safe.offer.id);
    expect(result.blockers).toEqual([
      { offerId: ambiguous.offer.id, reasons: ['Mapping is not verified'] },
      { offerId: incompatible.offer.id, reasons: ['Offer is incompatible with CO'] },
      { offerId: missingFinal.offer.id, reasons: ['Reliable COP final price is unavailable'] },
      { offerId: wrongFinalCurrency.offer.id, reasons: ['Reliable COP final price is unavailable'] },
    ]);
    expect(result.explanation).toContain('Exclusions:');
  });

  test('prefers lower final price before confidence and retailer trust', () => {
    const lowerLowTrust = candidate({
      id: '000000000009', amountMinor: 3_999_999, confidence: 'low', retailerClass: 'marketplace',
    });
    const higherHighTrust = candidate({
      id: '000000000010', amountMinor: 4_000_000, confidence: 'high', retailerClass: 'first_party_storefront',
    });

    expect(select([higherHighTrust, lowerLowTrust]).selected?.offer.id).toBe(lowerLowTrust.offer.id);
  });

  test('breaks equal-price ties by confidence, retailer class, then lexical offer ID', () => {
    const medium = candidate({ id: '000000000011', confidence: 'medium', retailerClass: 'first_party_storefront' });
    const highAuthorized = candidate({ id: '000000000012', confidence: 'high', retailerClass: 'authorized_store' });
    const highFirstPartyLater = candidate({ id: '000000000014', confidence: 'high', retailerClass: 'first_party_storefront' });
    const highFirstPartyEarlier = candidate({ id: '000000000013', confidence: 'high', retailerClass: 'first_party_storefront' });

    expect(select([medium, highAuthorized, highFirstPartyLater, highFirstPartyEarlier]).selected?.offer.id)
      .toBe(highFirstPartyEarlier.offer.id);
  });

  test('prefers a high-confidence authorized store over a medium-confidence first-party store at equal price', () => {
    const highAuthorized = candidate({
      id: '000000000018', confidence: 'high', retailerClass: 'authorized_store',
    });
    const mediumFirstParty = candidate({
      id: '000000000019', confidence: 'medium', retailerClass: 'first_party_storefront',
    });

    expect(select([mediumFirstParty, highAuthorized]).selected?.offer.id).toBe(highAuthorized.offer.id);
  });

  test('uses only matching-offer history in the requested comparison currency', () => {
    const reliable = candidate({
      id: '000000000020', amountMinor: 4_000_000, shippingKnown: false, taxesKnown: false,
    });
    const result = selectBestOffer({
      productVariant,
      country: 'CO',
      comparisonCurrency: 'COP',
      candidates: [reliable],
      history: [{
        id: 'b2d033a1-04e3-44a8-8e12-7bc3c2c97e18',
        offerId: reliable.offer.id,
        providerListingId: reliable.listing.id,
        sourceObservationKey: 'historical-low',
        originalPrice: { amountMinor: 3_500_000, currency: 'COP' },
        normalizedPrice: { amountMinor: 3_500_000, currency: 'COP' },
        observedAt: '2026-08-29T00:00:00.000Z',
      }, {
        id: 'a6f3971c-4b43-4d51-940c-60a44cb7c9db',
        offerId: '6c86d8de-9f26-494f-9462-000000000021',
        providerListingId: 'd0075e12-e721-4d0c-8ed4-000000000021',
        sourceObservationKey: 'other-offer-low',
        originalPrice: { amountMinor: 1, currency: 'COP' },
        normalizedPrice: { amountMinor: 1, currency: 'COP' },
        observedAt: '2026-08-29T00:00:00.000Z',
      }, {
        id: 'fac1ce43-009e-45fa-8fd5-3b8202b71f17',
        offerId: reliable.offer.id,
        providerListingId: reliable.listing.id,
        sourceObservationKey: 'wrong-currency-low',
        originalPrice: { amountMinor: 1, currency: 'USD' },
        normalizedPrice: { amountMinor: 1, currency: 'USD' },
        observedAt: '2026-08-29T00:00:00.000Z',
      }],
    });

    expect(result.explanation).toContain('Historical normalized low: COP 3,500,000');
    expect(result.negativeFactors).toEqual([
      'Shipping cost is unknown',
      'Taxes are unknown',
    ]);
  });

  test('returns a selected snapshot detached from caller-owned listing and money values', () => {
    const reliable = candidate({ id: '000000000022', amountMinor: 4_000_000 });
    const result = select([reliable]);

    reliable.offer.originalPrice.amountMinor = 1;
    reliable.offer.normalizedFinalPrice!.amountMinor = 1;
    reliable.listing.providerId = 'changed-by-caller';

    expect(result.selected).toMatchObject({
      listing: { providerId: 'deterministic' },
      offer: {
        originalPrice: { amountMinor: 4_000_000 },
        normalizedFinalPrice: { amountMinor: 4_000_000 },
      },
    });

    result.selected!.listing.providerId = 'changed-by-result';
    result.selected!.offer.originalPrice.amountMinor = 2;
    result.selected!.offer.normalizedFinalPrice!.amountMinor = 2;

    expect(reliable).toMatchObject({
      listing: { providerId: 'changed-by-caller' },
      offer: {
        originalPrice: { amountMinor: 1 },
        normalizedFinalPrice: { amountMinor: 1 },
      },
    });
  });
});
