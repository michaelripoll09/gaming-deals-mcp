import { describe, expect, test } from 'vitest';
import { normalizedProviderSyncSchema, providerCapabilitySchema } from '../../src/domain/providers/contracts.js';

const ids = {
  game: 'b8dd4e1d-c95c-4ea5-9916-8f8e11e2cf1a', release: 'd0d3c24f-23d2-4252-bd8b-51d636c1ab6f',
  edition: 'f79f8019-a877-4aa2-a6e3-4e5b8fd4cc8e', variant: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
  listing: 'd0075e12-e721-4d0c-8ed4-0b5e49f18bd2', offer: '6c86d8de-9f26-494f-9462-e2f74b00b0fb',
};
const validCatalogItem = {
  game: { id: ids.game, canonicalTitle: 'Example Game' },
  release: { id: ids.release, gameId: ids.game, title: 'Example Game', releaseYear: 2024 },
  edition: { id: ids.edition, releaseId: ids.release, name: 'Standard' },
  productVariant: { id: ids.variant, editionId: ids.edition, platform: 'pc', distribution: 'digital_storefront', regionCode: 'CO' },
};
const validListing = { id: ids.listing, providerId: 'deterministic', providerProductId: 'example', productVariantId: ids.variant, mappingState: 'verified' };
const validOffer = {
  id: ids.offer, providerListingId: ids.listing, sourceObservationKey: '2026-08-30T00:00:00.000Z',
  originalPrice: { amountMinor: 4999000, currency: 'COP' }, normalizedPrice: { amountMinor: 4999000, currency: 'COP' },
  normalizedFinalPrice: { amountMinor: 4999000, currency: 'COP' }, exchangeRateSource: 'identity', convertedAt: '2026-08-30T00:00:00.000Z',
  regionStatus: 'compatible', retailerClass: 'authorized_store', sourceConfidence: 'high', shippingKnown: true, taxesKnown: true,
  destinationUrl: 'https://example.test/game', observedAt: '2026-08-30T00:00:00.000Z',
};
const validPayload = () => ({ catalog: [validCatalogItem], listings: [validListing], offers: [validOffer] });

describe('providerCapabilitySchema', () => {
  const capability = { providerId: 'deterministic', displayName: 'Deterministic', retailerClass: 'authorized_store', sourceConfidence: 'high', supportedCountries: ['CO'], authentication: 'none', enabledByDefault: true };
  test('accepts a valid provider capability contract', () => { expect(providerCapabilitySchema.safeParse(capability).success).toBe(true); });
  test('rejects malformed supported countries', () => { expect(providerCapabilitySchema.safeParse({ ...capability, supportedCountries: ['colombia'] }).success).toBe(false); });
  test('rejects unsupported authentication', () => { expect(providerCapabilitySchema.safeParse({ ...capability, authentication: 'oauth' }).success).toBe(false); });
  test('rejects unknown capability fields', () => { expect(providerCapabilitySchema.safeParse({ ...capability, typo: true }).success).toBe(false); });
});

describe('normalizedProviderSyncSchema', () => {
  test('accepts a complete normalized sync payload', () => { expect(normalizedProviderSyncSchema.safeParse(validPayload()).success).toBe(true); });
  test('rejects a non-HTTPS destination URL', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), offers: [{ ...validOffer, destinationUrl: 'http://example.test/game' }] }).success).toBe(false); });
  test.each([['catalog', { catalog: [] }], ['listings', { listings: [] }], ['offers', { offers: [] }]])('rejects an empty %s collection independently', (collection, change) => {
    const result = normalizedProviderSyncSchema.safeParse({ ...validPayload(), ...change });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === 'too_small' && issue.path.length === 1 && issue.path[0] === collection)).toBe(true);
    }
  });
  test('rejects malformed timestamps', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), offers: [{ ...validOffer, observedAt: 'not-a-timestamp' }] }).success).toBe(false); });
  test('rejects negative minor amounts', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), offers: [{ ...validOffer, originalPrice: { amountMinor: -1, currency: 'COP' } }] }).success).toBe(false); });
  test('rejects fractional minor amounts', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), offers: [{ ...validOffer, originalPrice: { amountMinor: 1.5, currency: 'COP' } }] }).success).toBe(false); });
  test.each([
    ['unknown offer listing', { offers: [{ ...validOffer, providerListingId: ids.variant }] }],
    ['unknown listing variant', { listings: [{ ...validListing, productVariantId: ids.game }] }],
    ['verified listing without variant', { listings: [{ ...validListing, productVariantId: null }] }],
  ])('rejects a broken cross-array reference: %s', (_case, change) => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), ...change }).success).toBe(false); });
  test('preserves null variants for non-verified mappings', () => {
    const result = normalizedProviderSyncSchema.safeParse({ ...validPayload(), listings: [{ ...validListing, productVariantId: null, mappingState: 'ambiguous' }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.listings[0].productVariantId).toBeNull();
  });
  test('rejects unknown keys on the sync boundary', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), typo: true }).success).toBe(false); });
  test('rejects unknown keys on offers', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), offers: [{ ...validOffer, typo: true }] }).success).toBe(false); });
  test('rejects unknown keys on listings', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), listings: [{ ...validListing, typo: true }] }).success).toBe(false); });
  test('rejects unknown keys on catalog entries', () => { expect(normalizedProviderSyncSchema.safeParse({ ...validPayload(), catalog: [{ ...validCatalogItem, typo: true }] }).success).toBe(false); });
});
