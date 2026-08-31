import { describe, expect, test } from 'vitest';
import { normalizedProviderSyncSchema } from '../../src/domain/providers/contracts.js';

const validCatalogItem = {
  game: { id: 'b8dd4e1d-c95c-4ea5-9916-8f8e11e2cf1a', canonicalTitle: 'Example Game' },
  release: { id: 'd0d3c24f-23d2-4252-bd8b-51d636c1ab6f', gameId: 'b8dd4e1d-c95c-4ea5-9916-8f8e11e2cf1a', title: 'Example Game', releaseYear: 2024 },
  edition: { id: 'f79f8019-a877-4aa2-a6e3-4e5b8fd4cc8e', releaseId: 'd0d3c24f-23d2-4252-bd8b-51d636c1ab6f', name: 'Standard' },
  productVariant: { id: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c', editionId: 'f79f8019-a877-4aa2-a6e3-4e5b8fd4cc8e', platform: 'pc', distribution: 'digital_storefront', regionCode: 'CO' },
};

const validListing = {
  id: 'd0075e12-e721-4d0c-8ed4-0b5e49f18bd2',
  providerId: 'deterministic',
  providerProductId: 'example',
  productVariantId: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
  mappingState: 'verified',
};

const validOffer = {
  id: '6c86d8de-9f26-494f-9462-e2f74b00b0fb',
  providerListingId: validListing.id,
  sourceObservationKey: '2026-08-30T00:00:00.000Z',
  originalPrice: { amountMinor: 4999000, currency: 'COP' },
  normalizedPrice: { amountMinor: 4999000, currency: 'COP' },
  normalizedFinalPrice: { amountMinor: 4999000, currency: 'COP' },
  exchangeRateSource: 'identity',
  convertedAt: '2026-08-30T00:00:00.000Z',
  regionStatus: 'compatible',
  retailerClass: 'authorized_store',
  sourceConfidence: 'high',
  shippingKnown: true,
  taxesKnown: true,
  destinationUrl: 'https://example.test/game',
  observedAt: '2026-08-30T00:00:00.000Z',
};

describe('normalizedProviderSyncSchema', () => {
  test('rejects a non-HTTPS destination URL', () => {
    const result = normalizedProviderSyncSchema.safeParse({
      catalog: [validCatalogItem],
      listings: [validListing],
      offers: [{ ...validOffer, destinationUrl: 'http://example.test/game' }],
    });
    expect(result.success).toBe(false);
  });

  test('accepts a valid provider capability contract', async () => {
    const { providerCapabilitySchema } = await import('../../src/domain/providers/contracts.js');
    expect(providerCapabilitySchema.safeParse({
      providerId: 'deterministic', displayName: 'Deterministic', retailerClass: 'authorized_store',
      sourceConfidence: 'high', supportedCountries: ['CO'], authentication: 'none', enabledByDefault: true,
    }).success).toBe(true);
  });

  test('accepts a complete normalized sync payload', () => {
    expect(normalizedProviderSyncSchema.safeParse({
      catalog: [validCatalogItem], listings: [validListing], offers: [validOffer],
    }).success).toBe(true);
  });

  test('rejects empty sync collections and malformed identifiers', () => {
    const result = normalizedProviderSyncSchema.safeParse({
      catalog: [], listings: [], offers: [{ ...validOffer, id: 'not-a-uuid' }],
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative or fractional minor amounts', () => {
    expect(normalizedProviderSyncSchema.safeParse({
      catalog: [validCatalogItem], listings: [validListing],
      offers: [{ ...validOffer, originalPrice: { amountMinor: -1, currency: 'COP' } }],
    }).success).toBe(false);
    expect(normalizedProviderSyncSchema.safeParse({
      catalog: [validCatalogItem], listings: [validListing],
      offers: [{ ...validOffer, originalPrice: { amountMinor: 1.5, currency: 'COP' } }],
    }).success).toBe(false);
  });
});