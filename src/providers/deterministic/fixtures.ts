import type { NormalizedProviderSync } from '../../domain/providers/contracts.js';

/**
 * Stable, network-free provider data used as the contract reference fixture.
 *
 * The literal `as const` keeps this fixture immutable at compile time. The
 * provider validates it at its normalized boundary before exposing a result.
 */
const deterministicSyncFixture = {
  catalog: [
    {
      game: {
        id: '3dd3e5b8-1d42-4d9d-8b4b-75a1e2f5c301',
        canonicalTitle: 'Cobalt Horizon',
      },
      release: {
        id: 'f0e1d2c3-b4a5-4678-9012-3456789abcde',
        gameId: '3dd3e5b8-1d42-4d9d-8b4b-75a1e2f5c301',
        title: 'Cobalt Horizon',
        releaseYear: 2024,
      },
      edition: {
        id: '8c7b6a59-4837-4e2d-9f10-112233445566',
        releaseId: 'f0e1d2c3-b4a5-4678-9012-3456789abcde',
        name: 'Standard Edition',
      },
      productVariant: {
        id: '10293847-5647-4a3b-8c2d-1e0f9a8b7c6d',
        editionId: '8c7b6a59-4837-4e2d-9f10-112233445566',
        platform: 'pc',
        distribution: 'digital_storefront',
        regionCode: 'CO',
      },
    },
    {
      game: {
        id: 'b5e4d3c2-a190-4f8e-8d6c-5b4a39281706',
        canonicalTitle: 'Nebula Tactics',
      },
      release: {
        id: '22334455-6677-4889-9aab-bbccddeeff00',
        gameId: 'b5e4d3c2-a190-4f8e-8d6c-5b4a39281706',
        title: 'Nebula Tactics',
        releaseYear: 2025,
      },
      edition: {
        id: 'aabbccdd-eeff-4011-9223-344556677889',
        releaseId: '22334455-6677-4889-9aab-bbccddeeff00',
        name: 'Deluxe Edition',
      },
      productVariant: {
        id: 'fedcba98-7654-4b3a-9210-0fedcba98765',
        editionId: 'aabbccdd-eeff-4011-9223-344556677889',
        platform: 'pc',
        distribution: 'digital_storefront',
        regionCode: 'US',
      },
    },
  ],
  listings: [
    {
      id: '4b3a2918-07f6-45e4-9d2c-1b0a9f8e7d6c',
      providerId: 'deterministic',
      providerProductId: 'cobalt-horizon-standard-co',
      productVariantId: '10293847-5647-4a3b-8c2d-1e0f9a8b7c6d',
      mappingState: 'verified',
    },
    {
      id: '55667788-99aa-4bcc-8dde-ff0011223344',
      providerId: 'deterministic',
      providerProductId: 'nebula-tactics-deluxe-us',
      productVariantId: 'fedcba98-7654-4b3a-9210-0fedcba98765',
      mappingState: 'verified',
    },
    {
      id: '90abcdef-1234-4567-89ab-cdef01234567',
      providerId: 'deterministic',
      providerProductId: 'unresolved-mystery-bundle',
      productVariantId: null,
      mappingState: 'ambiguous',
    },
  ],
  offers: [
    {
      id: '13579bdf-2468-4ace-8bdf-02468ace1357',
      providerListingId: '4b3a2918-07f6-45e4-9d2c-1b0a9f8e7d6c',
      sourceObservationKey: 'deterministic:CO:COP:cobalt:2026-08-30',
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
      destinationUrl: 'https://example.test/cobalt-horizon',
      observedAt: '2026-08-30T00:00:00.000Z',
    },
    {
      id: '2468ace0-1357-4bdf-9246-8ace013579bd',
      providerListingId: '55667788-99aa-4bcc-8dde-ff0011223344',
      sourceObservationKey: 'deterministic:CO:COP:nebula:2026-08-30',
      originalPrice: { amountMinor: 12999000, currency: 'COP' },
      normalizedPrice: { amountMinor: 12999000, currency: 'COP' },
      normalizedFinalPrice: { amountMinor: 12999000, currency: 'COP' },
      exchangeRateSource: 'identity',
      convertedAt: '2026-08-30T00:00:00.000Z',
      regionStatus: 'incompatible',
      retailerClass: 'authorized_store',
      sourceConfidence: 'medium',
      shippingKnown: true,
      taxesKnown: true,
      destinationUrl: 'https://example.test/nebula-tactics',
      observedAt: '2026-08-30T00:00:00.000Z',
    },
    {
      id: 'abcdef01-2345-4678-9abc-def012345678',
      providerListingId: '90abcdef-1234-4567-89ab-cdef01234567',
      sourceObservationKey: 'deterministic:CO:COP:ambiguous:2026-08-30',
      originalPrice: { amountMinor: 799000, currency: 'COP' },
      normalizedPrice: { amountMinor: 799000, currency: 'COP' },
      normalizedFinalPrice: { amountMinor: 799000, currency: 'COP' },
      exchangeRateSource: 'identity',
      convertedAt: '2026-08-30T00:00:00.000Z',
      regionStatus: 'unknown',
      retailerClass: 'marketplace',
      sourceConfidence: 'low',
      shippingKnown: false,
      taxesKnown: false,
      destinationUrl: 'https://example.test/ambiguous-bundle',
      observedAt: '2026-08-30T00:00:00.000Z',
    },
  ],
} as const;

/** Return an isolated copy so callers cannot mutate the private source fixture. */
export function createDeterministicSyncFixture(): NormalizedProviderSync {
  return structuredClone(deterministicSyncFixture) as unknown as NormalizedProviderSync;
}
