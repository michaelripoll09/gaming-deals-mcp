import { AppError } from '../errors.js';
import { platformFamilySchema, type PlatformFamily } from '../catalog.js';
import { z } from 'zod';

export const providerIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Provider ID must be a lowercase slug');
export type ProviderId = z.infer<typeof providerIdSchema>;

export const capabilityNames = [
  'deal',
  'catalog',
  'library',
  'wishlist',
  'subscription',
  'currency',
  'physical_stock',
  'notification',
] as const;
export const capabilitySchema = z.enum(capabilityNames);
export type ProviderCapability = z.infer<typeof capabilitySchema>;

const onboardingTopicSchema = z
  .object({
    status: z.enum(['documented', 'unresolved']),
    content: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
  })
  .strict();

const automatedPriceComparisonPermissionSchema = z
  .object({
    status: z.enum(['permitted', 'prohibited', 'unresolved']),
    content: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
  })
  .strict();

const onboardingGateSchema = z
  .object({
    accessMechanism: onboardingTopicSchema,
    authenticationModel: onboardingTopicSchema,
    permittedUse: onboardingTopicSchema,
    rateLimitsAndPolling: onboardingTopicSchema,
    supportedCountriesAndPlatforms: onboardingTopicSchema,
    availableDataFields: onboardingTopicSchema,
    attributionAndAffiliateRequirements: onboardingTopicSchema,
    automatedPriceComparisonPermission: automatedPriceComparisonPermissionSchema,
    unavailableFallback: onboardingTopicSchema,
  })
  .strict();

const authenticationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('no_auth') }).strict(),
  z.object({ type: z.literal('api_credential') }).strict(),
  z.object({ type: z.literal('api_key') }).strict(),
  z.object({ type: z.literal('oauth_authorization') }).strict(),
  z
    .object({
      type: z.literal('provider_specific_approved'),
      approvalReference: z.string().trim().min(1),
    })
    .strict(),
]);

const uniqueCapabilitiesSchema = z
  .array(capabilitySchema)
  .min(1)
  .refine((capabilities) => new Set(capabilities).size === capabilities.length, {
    message: 'Provider capabilities must be unique',
  });

export const providerDefinitionSchema = z
  .object({
    providerId: providerIdSchema,
    displayName: z.string().trim().min(1),
    sourceCategory: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
    acquisitionSource: z.enum([
      'official_api',
      'partner_api',
      'public_feed',
      'public_page',
      'manual_provider',
    ]),
    /** Omitted means the provider is platform-agnostic; otherwise it is platform-scoped. */
    supportedPlatforms: z.array(platformFamilySchema).min(1).optional(),
    authentication: authenticationSchema,
    capabilities: uniqueCapabilitiesSchema,
    enabledByDefault: z.boolean(),
    access: z
      .object({
        state: z.enum(['experimental', 'approved']),
        onboarding: onboardingGateSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((definition, context) => {
    const { automatedPriceComparisonPermission, ...otherTopics } = definition.access.onboarding;
    const gateComplete =
      automatedPriceComparisonPermission.status === 'permitted' &&
      Object.values(otherTopics).every((topic) => topic.status === 'documented');
    if (definition.enabledByDefault && (definition.access.state !== 'approved' || !gateComplete)) {
      context.addIssue({
        code: 'custom',
        message:
          'Only approved providers with documented onboarding evidence for every topic may be enabled by default',
        path: ['enabledByDefault'],
      });
    }
  });
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;

export interface DealProvider {
  readonly capability: 'deal';
}
export interface CatalogProvider {
  readonly capability: 'catalog';
}
export interface LibraryProvider {
  readonly capability: 'library';
}
export interface WishlistProvider {
  readonly capability: 'wishlist';
}
export interface SubscriptionProvider {
  readonly capability: 'subscription';
}
export interface CurrencyProvider {
  readonly capability: 'currency';
}
export interface PhysicalStockProvider {
  readonly capability: 'physical_stock';
}
export interface NotificationProvider {
  readonly capability: 'notification';
}

export type ProviderCapabilityAdapter =
  | DealProvider
  | CatalogProvider
  | LibraryProvider
  | WishlistProvider
  | SubscriptionProvider
  | CurrencyProvider
  | PhysicalStockProvider
  | NotificationProvider;
export type ProviderAdapter = readonly ProviderCapabilityAdapter[];

type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface RegisteredProvider {
  readonly definition: DeepReadonly<ProviderDefinition>;
  readonly adapter: ProviderAdapter;
  readonly enabled: boolean;
}

interface ProviderRegistry {
  register(definition: ProviderDefinition, adapter: ProviderAdapter): RegisteredProvider;
  get(providerId: ProviderId): RegisteredProvider;
  list(): readonly RegisteredProvider[];
  providersForCapability(capability: ProviderCapability): readonly RegisteredProvider[];
  enabledProvidersForCapability(capability: ProviderCapability): readonly RegisteredProvider[];
  supports(
    providerId: ProviderId,
    capability: ProviderCapability,
    platform?: PlatformFamily,
  ): boolean;
  setEnabled(providerId: ProviderId, enabled: boolean): boolean;
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<
    ProviderId,
    {
      definition: DeepReadonly<ProviderDefinition>;
      adapter: ProviderAdapter;
      enabled: boolean;
    }
  >();

  function getEntry(providerId: ProviderId) {
    const entry = providers.get(providerId);
    if (!entry) throw new AppError('INPUT_INVALID', 'Provider is not registered');
    return entry;
  }

  function snapshot(definition: ProviderDefinition): DeepReadonly<ProviderDefinition> {
    const parsed = providerDefinitionSchema.parse(definition);
    const onboarding = Object.freeze({
      accessMechanism: Object.freeze({ ...parsed.access.onboarding.accessMechanism }),
      authenticationModel: Object.freeze({ ...parsed.access.onboarding.authenticationModel }),
      permittedUse: Object.freeze({ ...parsed.access.onboarding.permittedUse }),
      rateLimitsAndPolling: Object.freeze({ ...parsed.access.onboarding.rateLimitsAndPolling }),
      supportedCountriesAndPlatforms: Object.freeze({
        ...parsed.access.onboarding.supportedCountriesAndPlatforms,
      }),
      availableDataFields: Object.freeze({ ...parsed.access.onboarding.availableDataFields }),
      attributionAndAffiliateRequirements: Object.freeze({
        ...parsed.access.onboarding.attributionAndAffiliateRequirements,
      }),
      automatedPriceComparisonPermission: Object.freeze({
        ...parsed.access.onboarding.automatedPriceComparisonPermission,
      }),
      unavailableFallback: Object.freeze({ ...parsed.access.onboarding.unavailableFallback }),
    });
    const access = Object.freeze({ ...parsed.access, onboarding });
    const authentication = Object.freeze({ ...parsed.authentication });
    return Object.freeze({
      ...parsed,
      authentication,
      ...(parsed.supportedPlatforms === undefined
        ? {}
        : { supportedPlatforms: Object.freeze([...parsed.supportedPlatforms]) }),
      capabilities: Object.freeze([...parsed.capabilities]),
      access,
    });
  }

  function registered(entry: {
    definition: DeepReadonly<ProviderDefinition>;
    adapter: ProviderAdapter;
    enabled: boolean;
  }): RegisteredProvider {
    return Object.freeze({
      definition: entry.definition,
      adapter: entry.adapter,
      enabled: entry.enabled,
    });
  }

  return {
    register(definition, adapter) {
      const stableDefinition = snapshot(definition);
      if (providers.has(stableDefinition.providerId)) {
        throw new AppError('INPUT_INVALID', 'Provider ID is already registered');
      }
      const declared = new Set(stableDefinition.capabilities);
      const implemented = new Set(adapter.map((binding) => binding.capability));
      if (
        implemented.size !== adapter.length ||
        declared.size !== implemented.size ||
        [...declared].some((capability) => !implemented.has(capability))
      ) {
        throw new AppError('INPUT_INVALID', 'Provider capabilities do not match its adapter');
      }
      const stableAdapter = Object.freeze(adapter.map((binding) => Object.freeze(binding)));
      const entry = {
        definition: stableDefinition,
        adapter: stableAdapter,
        enabled: stableDefinition.enabledByDefault,
      };
      providers.set(stableDefinition.providerId, entry);
      return registered(entry);
    },
    get(providerId) {
      return registered(getEntry(providerId));
    },
    list() {
      return Object.freeze(
        [...providers.values()]
          .sort((left, right) =>
            left.definition.providerId < right.definition.providerId
              ? -1
              : left.definition.providerId > right.definition.providerId
                ? 1
                : 0,
          )
          .map(registered),
      );
    },
    providersForCapability(capability) {
      return Object.freeze(
        this.list().filter((provider) => provider.definition.capabilities.includes(capability)),
      );
    },
    enabledProvidersForCapability(capability) {
      return Object.freeze(
        this.providersForCapability(capability).filter((provider) => provider.enabled),
      );
    },
    supports(providerId, capability, platform) {
      const definition = getEntry(providerId).definition;
      return (
        definition.capabilities.includes(capability) &&
        (platform === undefined ||
          definition.supportedPlatforms === undefined ||
          definition.supportedPlatforms.includes(platform))
      );
    },
    setEnabled(providerId, enabled) {
      const entry = getEntry(providerId);
      if (enabled) {
        const { automatedPriceComparisonPermission, ...otherTopics } =
          entry.definition.access.onboarding;
        const gateComplete =
          automatedPriceComparisonPermission.status === 'permitted' &&
          Object.values(otherTopics).every((topic) => topic.status === 'documented');
        if (entry.definition.access.state !== 'approved' || !gateComplete) return false;
      }
      entry.enabled = enabled;
      return true;
    },
  };
}
