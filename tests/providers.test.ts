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
  type ProviderCapabilityAccess,
  type ProviderDefinition,
  type SubscriptionProvider,
  type WishlistProvider,
} from '../src/providers/registry.js';
import {
  validateProviderCatalogItem,
  validateProviderDeal,
  type ProviderCatalogItem,
  type ProviderDeal,
} from '../src/providers/contracts.js';
import { Money } from '../src/money.js';

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
  Assert<
    IsAssignable<
      {
        readonly capability: 'deal';
        listDeals: (signal?: AbortSignal) => Promise<readonly ProviderDeal[]>;
      },
      DealProvider
    >
  >,
  Assert<
    IsAssignable<
      {
        readonly capability: 'catalog';
        listCatalog: (signal?: AbortSignal) => Promise<readonly ProviderCatalogItem[]>;
      },
      CatalogProvider
    >
  >,
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
type ProviderMethodsAcceptOptionalAbortSignals = [
  Assert<IsAssignable<1, Parameters<CatalogProvider['listCatalog']>['length']>>,
  Assert<IsAssignable<AbortSignal, NonNullable<Parameters<CatalogProvider['listCatalog']>[0]>>>,
  Assert<IsAssignable<1, Parameters<DealProvider['listDeals']>['length']>>,
  Assert<IsAssignable<AbortSignal, NonNullable<Parameters<DealProvider['listDeals']>[0]>>>,
];
const providerMethodsAcceptOptionalAbortSignals: ProviderMethodsAcceptOptionalAbortSignals = [
  true,
  true,
  true,
  true,
];

const catalogBinding: ProviderAdapter[number] = {
  capability: 'catalog',
  listCatalog: async () => [],
};
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
    expect(providerMethodsAcceptOptionalAbortSignals).toEqual([true, true, true, true]);
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
    expect(() =>
      registry.register(definition(), [{ capability: 'deal', listDeals: async () => [] }]),
    ).toThrow();
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

  it('validates and freezes provider-native catalog and deal records', () => {
    const item: ProviderCatalogItem = {
      providerProductId: 'store-product-1',
      title: 'Example Game',
      platform: { family: 'pc', variant: 'Steam' },
      distribution: 'digital_storefront',
    };
    const deal: ProviderDeal = {
      providerOfferId: 'offer-1',
      providerProductId: 'store-product-1',
      priceOriginal: Money.create(1299, 'USD'),
      offerUrl: 'https://store.example/offers/offer-1?campaign=spring',
    };
    expect(validateProviderCatalogItem(item)).toEqual(item);
    expect(validateProviderDeal(deal)).toEqual(deal);
    expect(
      validateProviderDeal({ ...deal, offerUrl: 'http://store.example/offers/offer-1' }).offerUrl,
    ).toBe('http://store.example/offers/offer-1');
    expect(Object.isFrozen(validateProviderCatalogItem(item))).toBe(true);
    expect(Object.isFrozen(validateProviderCatalogItem(item).platform)).toBe(true);
    expect(Object.isFrozen(validateProviderDeal(deal).priceOriginal)).toBe(true);
    expect(validateProviderDeal({ ...deal, providerOfferId: ' offer-1 ' }).providerOfferId).toBe(
      'offer-1',
    );
    expect(
      validateProviderDeal({ ...deal, providerProductId: ' product-1 ' }).providerProductId,
    ).toBe('product-1');
    for (const invalidId of ['', '   ']) {
      expect(() => validateProviderDeal({ ...deal, providerOfferId: invalidId })).toThrow(
        'Input is invalid',
      );
      expect(() => validateProviderDeal({ ...deal, providerProductId: invalidId })).toThrow(
        'Input is invalid',
      );
    }
    expect(() => validateProviderCatalogItem({ ...item, canonicalProductId: 'product-1' })).toThrow(
      'Input is invalid',
    );
    expect(
      validateProviderDeal({
        ...deal,
        priceOriginal: { amountMinor: 0, currency: 'USD' },
      }).priceOriginal.amountMinor,
    ).toBe(0);
    for (const invalidPrice of [
      { amountMinor: 1, currency: 'ZZZ' },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' },
      { amountMinor: -1, currency: 'USD' },
    ]) {
      expect(() => validateProviderDeal({ ...deal, priceOriginal: invalidPrice })).toThrow(
        'Input is invalid',
      );
    }
    expect(() => validateProviderDeal({ ...deal, offerUrl: 'javascript:alert(1)' })).toThrow(
      'Input is invalid',
    );
    const malformedSensitiveUrl = 'https://bad host.example/path?token=private-value';
    try {
      validateProviderDeal({ ...deal, offerUrl: malformedSensitiveUrl });
      throw new Error('Expected URL validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INPUT_INVALID' });
      expect(error instanceof Error ? error.message : String(error)).not.toContain('private-value');
    }
  });

  it('preserves caller-owned stateful provider implementations behind stable frozen facades', async () => {
    const registry = createProviderRegistry();
    const catalog = {
      capability: 'catalog' as const,
      calls: 0,
      async listCatalog(this: { calls: number }) {
        this.calls += 1;
        return [];
      },
    };
    const deal = {
      capability: 'deal' as const,
      calls: 0,
      async listDeals(this: { calls: number }) {
        this.calls += 1;
        return [];
      },
    };
    const adapters = [catalog, deal];
    registry.register(definition({ capabilities: ['catalog', 'deal'] }), adapters);

    adapters.splice(0, adapters.length);

    const catalogAccess = registry.getCapability('sample-store', 'catalog');
    expect(catalogAccess.status).toBe('disabled');
    registry.setEnabled('sample-store', true);
    const enabledCatalog = registry.getCapability('sample-store', 'catalog');
    expect(enabledCatalog.status).toBe('available');
    if (enabledCatalog.status === 'available') {
      const facade = enabledCatalog.adapter;
      expect(Object.isFrozen(facade)).toBe(true);
      const stableCatalog = registry.getCapability('sample-store', 'catalog');
      if (stableCatalog.status === 'available') {
        expect(facade).toBe(stableCatalog.adapter);
      }
      await facade.listCatalog();
      expect(catalog.calls).toBe(1);
      await facade.listCatalog();
      expect(catalog.calls).toBe(2);
      Reflect.set(catalog, 'capability', 'deal');
      expect(facade.capability).toBe('catalog');
    }

    const enabledDeal = registry.getCapability('sample-store', 'deal');
    expect(enabledDeal.status).toBe('available');
    if (enabledDeal.status === 'available') {
      const facade = enabledDeal.adapter;
      expect(Object.isFrozen(facade)).toBe(true);
      await facade.listDeals();
      expect(deal.calls).toBe(1);
      await facade.listDeals();
      expect(deal.calls).toBe(2);
      Reflect.set(deal, 'capability', 'catalog');
      expect(facade.capability).toBe('deal');
    }
    expect(Object.isFrozen(catalog)).toBe(false);
    expect(Object.isFrozen(deal)).toBe(false);
    expect(Object.isFrozen(catalog)).toBe(false);
    expect(Object.isFrozen(deal)).toBe(false);
    expect(registry.getCapability('sample-store', 'library').status).toBe('missing_capability');
  });

  it('retrieves typed capability execution only when enabled, distinguishing disabled and missing capability', async () => {
    const registry = createProviderRegistry();
    const listCatalog = async (): Promise<readonly ProviderCatalogItem[]> => [];
    const listDeals = async (): Promise<readonly ProviderDeal[]> => [];
    const catalog = { capability: 'catalog' as const, listCatalog };
    const deal = { capability: 'deal' as const, listDeals };
    registry.register(definition({ capabilities: ['catalog', 'deal'] }), [catalog, deal]);
    expect(registry.get('sample-store')).not.toHaveProperty('adapter');
    expect(registry.setEnabled('sample-store', true)).toBe(true);

    const enabledCatalog: ProviderCapabilityAccess<'catalog'> = registry.getCapability(
      'sample-store',
      'catalog',
    );
    expect(enabledCatalog.status).toBe('available');
    if (enabledCatalog.status === 'available' && enabledCatalog.adapter.capability === 'catalog') {
      expect(await enabledCatalog.adapter.listCatalog()).toEqual([]);
    }
    const enabledDeal = registry.getCapability('sample-store', 'deal');
    expect(enabledDeal.status).toBe('available');
    if (enabledDeal.status === 'available') {
      expect(await enabledDeal.adapter.listDeals()).toEqual([]);
    }
    expect(registry.getCapability('sample-store', 'library').status).toBe('missing_capability');
    registry.setEnabled('sample-store', false);
    expect(registry.getCapability('sample-store', 'catalog').status).toBe('disabled');
    expect(registry.providersForCapability('catalog')).toHaveLength(1);
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
