import { describe, expect, test } from 'vitest';
import { normalizedProviderSyncSchema, providerCapabilitySchema } from '../../src/domain/providers/contracts.js';
import { DeterministicDealProvider } from '../../src/providers/deterministic/deterministic-provider.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';

describe('DeterministicDealProvider', () => {
  test('declares a non-secret PC capability and emits stable fixtures', async () => {
    const provider = new DeterministicDealProvider();
    const input = { country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z' };
    const first = await provider.sync(input);
    const second = await provider.sync(input);

    expect(provider.capability).toMatchObject({
      providerId: 'deterministic',
      supportedCountries: ['CO'],
      authentication: 'none',
      enabledByDefault: true,
    });
    expect(providerCapabilitySchema.parse(provider.capability)).toEqual(provider.capability);
    expect(normalizedProviderSyncSchema.parse(first)).toEqual(second);
  });

  test('contains an ambiguous mapping fixture that cannot later win', async () => {
    const provider = new DeterministicDealProvider();
    const result = normalizedProviderSyncSchema.parse(await provider.sync({
      country: 'CO',
      comparisonCurrency: 'COP',
      now: '2026-08-30T00:00:00.000Z',
    }));

    expect(result.listings.some((listing) => listing.mappingState === 'ambiguous')).toBe(true);
  });

  test('keeps compatible and incompatible verified offers distinguishable', async () => {
    const provider = new DeterministicDealProvider();
    const result = normalizedProviderSyncSchema.parse(await provider.sync({
      country: 'CO',
      comparisonCurrency: 'COP',
      now: '2026-08-30T00:00:00.000Z',
    }));

    expect(result.catalog).toHaveLength(2);
    expect(result.listings.filter((listing) => listing.mappingState === 'verified')).toHaveLength(2);
    expect(result.offers.map((offer) => offer.regionStatus)).toEqual(['compatible', 'incompatible', 'unknown']);
    expect(result.offers.every((offer) => offer.originalPrice.currency === 'COP')).toBe(true);
    expect(result.offers.every((offer) => offer.destinationUrl.startsWith('https://example.test/'))).toBe(true);
  });

  test('does not vary when only the requested current time changes', async () => {
    const provider = new DeterministicDealProvider();
    const first = await provider.sync({ country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z' });
    const second = await provider.sync({ country: 'CO', comparisonCurrency: 'COP', now: '2030-01-01T12:34:56.000Z' });

    expect(first).toEqual(second);
  });

  test('does not share mutable state between returned payloads', async () => {
    const provider = new DeterministicDealProvider();
    const first = normalizedProviderSyncSchema.parse(await provider.sync({
      country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z',
    }));
    first.catalog[0].game.canonicalTitle = 'Consumer mutation';
    first.offers[0].originalPrice.amountMinor = 1;

    const second = normalizedProviderSyncSchema.parse(await provider.sync({
      country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z',
    }));

    expect(second.catalog[0].game.canonicalTitle).toBe('Cobalt Horizon');
    expect(second.offers[0].originalPrice.amountMinor).toBe(4999000);
  });

  test('rejects a malformed normalized payload with its boundary issue path', async () => {
    const malformed = createDeterministicSyncFixture();
    malformed.offers[0].destinationUrl = 'http://example.test/not-https';
    const provider = new DeterministicDealProvider(() => malformed);

    await expect(provider.sync({ country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z' }))
      .rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['offers', 0, 'destinationUrl'] }),
        ]),
      });
  });

  test('links explicit region outcomes to their verified and ambiguous listings', async () => {
    const provider = new DeterministicDealProvider();
    const result = normalizedProviderSyncSchema.parse(await provider.sync({
      country: 'CO', comparisonCurrency: 'COP', now: '2026-08-30T00:00:00.000Z',
    }));
    const listingsById = new Map(result.listings.map((listing) => [listing.id, listing]));

    const compatibleOffer = result.offers.find((offer) => offer.regionStatus === 'compatible');
    const incompatibleOffer = result.offers.find((offer) => offer.regionStatus === 'incompatible');
    const unknownOffer = result.offers.find((offer) => offer.regionStatus === 'unknown');
    expect(compatibleOffer && listingsById.get(compatibleOffer.providerListingId)).toMatchObject({
      mappingState: 'verified', productVariantId: result.catalog[0].productVariant.id,
    });
    expect(incompatibleOffer && listingsById.get(incompatibleOffer.providerListingId)).toMatchObject({
      mappingState: 'verified', productVariantId: result.catalog[1].productVariant.id,
    });
    expect(unknownOffer && listingsById.get(unknownOffer.providerListingId)).toMatchObject({
      mappingState: 'ambiguous', productVariantId: null,
    });
  });
});
