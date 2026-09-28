import { describe, expect, it } from 'vitest';
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

const catalogBinding: ProviderAdapter[number] = { capability: 'catalog' };
const catalogAdapter: ProviderAdapter = [catalogBinding];

describe('provider metadata and runtime registry', () => {
  it('validates stable provider IDs, source categories, acquisition values, and capability names', () => {
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
    const { supportedPlatforms: _platforms, ...platformAgnosticDefinition } = definition();
    registry.register(platformAgnosticDefinition, catalogAdapter);
    expect(registry.supports('sample-store', 'catalog', 'playstation')).toBe(true);
  });

  it('rejects duplicate and definition-mismatched adapter capabilities at registry registration', () => {
    const registry = createProviderRegistry();
    expect(() => registry.register(definition(), [catalogBinding, catalogBinding])).toThrow();
    expect(() => registry.register(definition(), [{ capability: 'deal' }])).toThrow();
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
