import { describe, expect, it } from 'vitest';
import { validateProviderCatalogItem, validateProviderDeal } from '../src/providers/contracts.js';
import {
  capabilityNames,
  createProviderRegistry,
  providerDefinitionSchema,
  providerIdSchema,
  type CatalogProvider,
  type DealProvider,
  type CurrencyProvider,
  type LibraryProvider,
  type NotificationProvider,
  type PhysicalStockProvider,
  type ProviderAdapter,
  type ProviderDefinition,
  type SubscriptionProvider,
  type WishlistProvider,
} from '../src/providers/registry.js';

function gateTopic(status: 'documented' | 'unresolved', content: string, evidence: string) {
  return { status, content, evidence };
}

const completeGate: ProviderDefinition['access']['onboarding'] = {
  accessMechanism: {
    status: 'documented',
    content: 'Access mechanism terms',
    evidence: 'https://example.test/access',
  },
  authenticationModel: {
    status: 'documented',
    content: 'Authentication model terms',
    evidence: 'https://example.test/authentication',
  },
  permittedUse: {
    status: 'documented',
    content: 'Permitted use terms',
    evidence: 'https://example.test/use',
  },
  rateLimitsAndPolling: {
    status: 'documented',
    content: 'Rate and polling terms',
    evidence: 'https://example.test/rates',
  },
  supportedCountriesAndPlatforms: {
    status: 'documented',
    content: 'Countries and platforms terms',
    evidence: 'https://example.test/platforms',
  },
  availableDataFields: {
    status: 'documented',
    content: 'Available data fields terms',
    evidence: 'https://example.test/fields',
  },
  attributionAndAffiliateRequirements: {
    status: 'documented',
    content: 'Attribution terms',
    evidence: 'https://example.test/attribution',
  },
  automatedPriceComparisonPermission: {
    status: 'permitted',
    content: 'Price comparison terms',
    evidence: 'https://example.test/comparison',
  },
  unavailableFallback: {
    status: 'documented',
    content: 'Unavailable fallback terms',
    evidence: 'https://example.test/fallback',
  },
};

function definition(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    providerId: 'sample-store',
    displayName: 'Sample Store',
    sourceCategory: 'retailer-specialist',
    acquisitionSource: 'official_api',
    supportedPlatforms: ['pc'],
    authentication: { type: 'no_auth' },
    capabilities: ['catalog'],
    enabledByDefault: false,
    access: { state: 'approved', onboarding: completeGate },
    ...overrides,
  };
}

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type Assert<T extends true> = T;
type AssertNot<T extends false> = T;
type ProviderContractsHaveExactMarkers = [
  Assert<IsAssignable<{ readonly capability: 'deal' }, DealProvider>>,
  Assert<IsAssignable<{ readonly capability: 'catalog' }, CatalogProvider>>,
  Assert<IsAssignable<{ readonly capability: 'library' }, LibraryProvider>>,
  Assert<IsAssignable<{ readonly capability: 'wishlist' }, WishlistProvider>>,
  Assert<IsAssignable<{ readonly capability: 'subscription' }, SubscriptionProvider>>,
  Assert<IsAssignable<{ readonly capability: 'currency' }, CurrencyProvider>>,
  Assert<IsAssignable<{ readonly capability: 'physical_stock' }, PhysicalStockProvider>>,
  Assert<IsAssignable<{ readonly capability: 'notification' }, NotificationProvider>>,
  AssertNot<IsAssignable<{ readonly capability: 'deal' }, CatalogProvider>>,
  AssertNot<IsAssignable<{ readonly capability: 'catalog' }, DealProvider>>,
];
const providerContractsHaveExactMarkers: ProviderContractsHaveExactMarkers = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  false,
  false,
];

const catalogBinding: ProviderAdapter[number] = { capability: 'catalog' };
const catalogAdapter: ProviderAdapter = [catalogBinding];

describe('provider metadata and runtime registry', () => {
  it('validates stable provider IDs, source categories, acquisition values, and capability names', () => {
    expect(providerContractsHaveExactMarkers).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(providerIdSchema.parse('good-provider_2')).toBe('good-provider_2');
    expect(() => providerIdSchema.parse('Not A Slug')).toThrow();
    expect(capabilityNames).toEqual([
      'deal',
      'catalog',
      'library',
      'wishlist',
      'subscription',
      'currency',
      'physical_stock',
      'notification',
    ]);
    expect(() =>
      providerDefinitionSchema.parse({ ...definition(), acquisitionSource: 'scrape' }),
    ).toThrow();
    expect(() =>
      providerDefinitionSchema.parse({ ...definition(), sourceCategory: 'bad category' }),
    ).toThrow();
    expect(providerDefinitionSchema.parse(definition()).sourceCategory).toBe('retailer-specialist');
  });

  it('requires all nine structured onboarding topics and rejects secret material fields', () => {
    expect(providerDefinitionSchema.parse(definition()).access.onboarding).toEqual(completeGate);
    const incompleteGate = {
      ...completeGate,
      unavailableFallback: gateTopic(
        'unresolved',
        'Fallback not confirmed',
        'https://example.test/fallback',
      ),
    };
    expect(() =>
      providerDefinitionSchema.parse(
        definition({ access: { state: 'approved', onboarding: incompleteGate } }),
      ),
    ).not.toThrow();
    expect(() =>
      providerDefinitionSchema.parse({
        ...definition(),
        access: { state: 'approved', onboarding: { ...completeGate, apiKey: 'secret' } },
      }),
    ).toThrow();
    expect(() =>
      providerDefinitionSchema.parse({
        ...definition(),
        access: {
          state: 'approved',
          onboarding: {
            ...completeGate,
            accessMechanism: { ...completeGate.accessMechanism, password: 'secret' },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      providerDefinitionSchema.parse({
        ...definition(),
        access: {
          state: 'approved',
          onboarding: { ...completeGate, authenticationModel: undefined },
        },
      }),
    ).toThrow();
  });

  it('requires explicit permission for automated price comparison before default enablement', () => {
    const prohibitedGate: ProviderDefinition['access']['onboarding'] = {
      ...completeGate,
      automatedPriceComparisonPermission: {
        status: 'prohibited',
        content: 'Automated price comparison is prohibited',
        evidence: 'https://example.test/comparison-prohibited',
      },
    };

    expect(() =>
      providerDefinitionSchema.parse(
        definition({
          access: { state: 'approved', onboarding: prohibitedGate },
          enabledByDefault: true,
        }),
      ),
    ).toThrow();
    expect(
      providerDefinitionSchema.parse(
        definition({
          access: { state: 'approved', onboarding: prohibitedGate },
          enabledByDefault: false,
        }),
      ).access.onboarding.automatedPriceComparisonPermission.status,
    ).toBe('prohibited');
    expect(
      providerDefinitionSchema.parse(
        definition({
          access: { state: 'approved', onboarding: completeGate },
          enabledByDefault: true,
        }),
      ).enabledByDefault,
    ).toBe(true);
  });

  it('requires approval and complete evidence before default enablement', () => {
    expect(() =>
      providerDefinitionSchema.parse(
        definition({
          access: { state: 'experimental', onboarding: completeGate },
          enabledByDefault: true,
        }),
      ),
    ).toThrow();
    const incompleteGate = {
      ...completeGate,
      permittedUse: gateTopic(
        'unresolved',
        'Permitted use not confirmed',
        'https://example.test/use',
      ),
    };
    expect(() =>
      providerDefinitionSchema.parse(
        definition({
          access: { state: 'approved', onboarding: incompleteGate },
          enabledByDefault: true,
        }),
      ),
    ).toThrow();
    expect(
      providerDefinitionSchema.parse(definition({ enabledByDefault: true })).enabledByDefault,
    ).toBe(true);
  });

  it('models authentication requirements without secret values or storefront passwords', () => {
    for (const authentication of [
      { type: 'no_auth' },
      { type: 'api_credential' },
      { type: 'api_key' },
      { type: 'oauth_authorization' },
      { type: 'provider_specific_approved', approvalReference: 'approval-123' },
    ]) {
      expect(() =>
        providerDefinitionSchema.parse({ ...definition(), authentication }),
      ).not.toThrow();
    }
    expect(() =>
      providerDefinitionSchema.parse({
        ...definition(),
        authentication: { type: 'storefront_password' },
      }),
    ).toThrow();
    expect(() =>
      providerDefinitionSchema.parse({
        ...definition(),
        authentication: { type: 'api_key', value: 'secret' },
      }),
    ).toThrow();
  });

  it('distinguishes platform-agnostic and platform-scoped support using catalog families', () => {
    expect(() =>
      providerDefinitionSchema.parse({ ...definition(), supportedPlatforms: ['all'] }),
    ).toThrow();
    expect(
      providerDefinitionSchema.parse(definition({ supportedPlatforms: ['nintendo', 'xbox'] }))
        .supportedPlatforms,
    ).toEqual(['nintendo', 'xbox']);
    const registry = createProviderRegistry();
    const platformAgnosticDefinition = definition();
    delete platformAgnosticDefinition.supportedPlatforms;
    registry.register(platformAgnosticDefinition, catalogAdapter);
    expect(registry.supports('sample-store', 'catalog', 'playstation')).toBe(true);
  });

  it('rejects duplicate and definition-mismatched adapter capabilities at registry registration', () => {
    const registry = createProviderRegistry();
    expect(() => registry.register(definition(), [catalogBinding, catalogBinding])).toThrow();
    expect(() => registry.register(definition(), [{ capability: 'deal' }])).toThrow();
  });

  it('requires explicit experimental opt-in to enable experimental or incomplete providers', () => {
    const registry = createProviderRegistry();
    const experimental = definition({
      providerId: 'experimental-store',
      access: { state: 'experimental', onboarding: completeGate },
    });
    registry.register(experimental, catalogAdapter);

    expect(registry.get('experimental-store').enabled).toBe(false);
    expect(registry.setEnabled('experimental-store', true)).toBe(false);
    expect(
      registry.setEnabled('experimental-store', true, { explicitExperimentalOptIn: true }),
    ).toBe(true);
    expect(registry.enabledProvidersForCapability('catalog')).toHaveLength(1);
    expect(registry.get('experimental-store').definition.access.state).toBe('experimental');
    expect(registry.setEnabled('experimental-store', false)).toBe(true);
    expect(registry.enabledProvidersForCapability('catalog')).toHaveLength(0);
    expect(
      registry.setEnabled('experimental-store', true, { explicitExperimentalOptIn: true }),
    ).toBe(true);

    const incompleteGate = {
      ...completeGate,
      permittedUse: gateTopic('unresolved', 'Not confirmed', 'https://example.test/use'),
    };
    registry.register(
      definition({
        providerId: 'incomplete-store',
        access: { state: 'approved', onboarding: incompleteGate },
      }),
      catalogAdapter,
    );
    expect(registry.setEnabled('incomplete-store', true)).toBe(false);
    expect(registry.setEnabled('incomplete-store', true, { explicitExperimentalOptIn: true })).toBe(
      true,
    );

    const prohibitedGate = {
      ...completeGate,
      automatedPriceComparisonPermission: {
        status: 'prohibited' as const,
        content: 'Comparison prohibited',
        evidence: 'https://example.test/prohibited',
      },
    };
    registry.register(
      definition({
        providerId: 'prohibited-store',
        access: { state: 'experimental', onboarding: prohibitedGate },
      }),
      catalogAdapter,
    );
    expect(registry.setEnabled('prohibited-store', true, { explicitExperimentalOptIn: true })).toBe(
      false,
    );
  });

  it('registers immutable definitions in deterministic order and provides get, list, capability, and enable controls', () => {
    const registry = createProviderRegistry();
    registry.register(definition({ providerId: 'z-store' }), catalogAdapter);
    registry.register(definition({ providerId: 'a-store' }), catalogAdapter);
    expect(registry.list().map((provider) => provider.definition.providerId)).toEqual([
      'a-store',
      'z-store',
    ]);
    const registeredProvider = registry.get('a-store');
    expect(Object.isFrozen(registeredProvider)).toBe(true);
    expect(Object.isFrozen(registeredProvider.definition.authentication)).toBe(true);
    expect(
      registry.providersForCapability('catalog').map((provider) => provider.definition.providerId),
    ).toEqual(['a-store', 'z-store']);
    expect(registry.supports('a-store', 'catalog')).toBe(true);
    expect(registry.supports('a-store', 'catalog', 'playstation')).toBe(false);
    expect(() =>
      registry.register(definition({ providerId: 'a-store' }), catalogAdapter),
    ).toThrow();
    expect(() =>
      providerDefinitionSchema.parse({ ...definition(), capabilities: ['catalog', 'catalog'] }),
    ).toThrow();
    expect(() => registry.register(definition(), [catalogBinding, catalogBinding])).toThrow();
    expect(registry.setEnabled('a-store', true)).toBe(true);
    expect(registry.enabledProvidersForCapability('catalog')).toHaveLength(1);
    expect(registry.setEnabled('a-store', false)).toBe(true);
    expect(registry.get('a-store').enabled).toBe(false);
    expect(registry.enabledProvidersForCapability('catalog')).toHaveLength(0);
  });
});

describe('provider-native catalog and deal contracts', () => {
  const catalogItem = {
    providerProductId: ' game-1 ',
    title: ' Example Game ',
    platform: { family: 'pc' as const, variant: ' Steam Deck ' },
    distribution: 'digital_storefront' as const,
  };

  const deal = (overrides: Record<string, unknown> = {}) => ({
    providerOfferId: ' offer-1 ',
    providerProductId: ' game-1 ',
    priceOriginal: { amountMinor: 1299, currency: 'USD' },
    offerUrl: 'https://store.example/offer',
    ...overrides,
  });

  it('trims valid catalog item text and freezes the item and nested platform', () => {
    const result = validateProviderCatalogItem(catalogItem);

    expect(result).toEqual({
      providerProductId: 'game-1',
      title: 'Example Game',
      platform: { family: 'pc', variant: 'Steam Deck' },
      distribution: 'digital_storefront',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.platform)).toBe(true);
  });

  it('rejects empty catalog IDs, titles, platform variants, and extra keys', () => {
    expect(() =>
      validateProviderCatalogItem({ ...catalogItem, providerProductId: '  ' }),
    ).toThrow();
    expect(() => validateProviderCatalogItem({ ...catalogItem, title: '  ' })).toThrow();
    expect(() =>
      validateProviderCatalogItem({
        ...catalogItem,
        platform: { family: 'pc', variant: '  ' },
      }),
    ).toThrow();
    expect(() => validateProviderCatalogItem({ ...catalogItem, extra: true })).toThrow();
    expect(() =>
      validateProviderCatalogItem({
        ...catalogItem,
        platform: { family: 'pc', extra: true },
      }),
    ).toThrow();
  });

  it('trims deal IDs, accepts HTTP and HTTPS, and freezes deal and Money output', () => {
    for (const offerUrl of ['http://store.example/offer', 'https://store.example/offer']) {
      const result = validateProviderDeal(deal({ offerUrl }));

      expect(result.providerOfferId).toBe('offer-1');
      expect(result.providerProductId).toBe('game-1');
      expect(result.offerUrl).toBe(offerUrl);
      expect(result.priceOriginal).toEqual({ amountMinor: 1299, currency: 'USD' });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.priceOriginal)).toBe(true);
    }
  });

  it('accepts zero and rejects negative, unsafe, malformed-currency, and extra price data', () => {
    expect(
      validateProviderDeal(deal({ priceOriginal: { amountMinor: 0, currency: 'USD' } }))
        .priceOriginal.amountMinor,
    ).toBe(0);
    expect(() =>
      validateProviderDeal(deal({ priceOriginal: { amountMinor: -1, currency: 'USD' } })),
    ).toThrow();
    expect(() =>
      validateProviderDeal(
        deal({ priceOriginal: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' } }),
      ),
    ).toThrow();
    expect(() =>
      validateProviderDeal(deal({ priceOriginal: { amountMinor: 1, currency: 'usd' } })),
    ).toThrow();
    expect(() =>
      validateProviderDeal(deal({ priceOriginal: { amountMinor: 1, currency: 'ZZZ' } })),
    ).toThrow();
    expect(() =>
      validateProviderDeal(
        deal({ priceOriginal: { amountMinor: 1, currency: 'USD', extra: true } }),
      ),
    ).toThrow();
  });

  it('rejects blank deal IDs and strict-object extras', () => {
    expect(() => validateProviderDeal(deal({ providerOfferId: '  ' }))).toThrow();
    expect(() => validateProviderDeal(deal({ providerProductId: '  ' }))).toThrow();
    expect(() => validateProviderDeal(deal({ extra: true }))).toThrow();
  });

  it('rejects non-HTTP(S) and malformed URLs with safe input errors', () => {
    for (const offerUrl of ['javascript:alert(1)', 'http://[']) {
      let capturedError: unknown;
      try {
        validateProviderDeal(deal({ offerUrl }));
      } catch (error) {
        capturedError = error;
      }

      expect(capturedError).toMatchObject({ code: 'INPUT_INVALID', message: 'Input is invalid' });
      expect(String(capturedError)).not.toContain(offerUrl);
    }
  });

  it('rejects offer URLs with embedded control characters using safe input errors', () => {
    for (const offerUrl of [
      'https://store.exa\nmple/offer',
      'https://store.exa\rmple/offer',
      'https://store.exa\tmple/offer',
    ]) {
      let capturedError: unknown;
      try {
        validateProviderDeal(deal({ offerUrl }));
      } catch (error) {
        capturedError = error;
      }

      expect(capturedError).toMatchObject({ code: 'INPUT_INVALID', message: 'Input is invalid' });
      expect(String(capturedError)).not.toContain(offerUrl);
    }
  });

  it('returns safe errors for embedded credential URLs', () => {
    let capturedError: unknown;
    try {
      validateProviderDeal(deal({ offerUrl: 'https://user:secret@store.example/offer' }));
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toMatchObject({ code: 'INPUT_INVALID', message: 'Input is invalid' });
    expect(String(capturedError)).not.toContain('user');
    expect(String(capturedError)).not.toContain('secret');
  });
});
