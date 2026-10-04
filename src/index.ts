export { loadConfig, type AppConfig, type ConfigOverrides } from './config.js';
export {
  createCoreServices,
  type Clock,
  type CoreServices,
  type CoreServicesOptions,
} from './core-services.js';
export {
  capabilityNames,
  capabilitySchema,
  createProviderRegistry,
  providerDefinitionSchema,
  providerIdSchema,
  type CatalogProvider,
  type CurrencyProvider,
  type DealProvider,
  type LibraryProvider,
  type NotificationProvider,
  type PhysicalStockProvider,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderCapabilityAdapter,
  type ProviderDefinition,
  type ProviderId,
  type ProviderRegistry,
  type RegisteredProvider,
  type SubscriptionProvider,
  type WishlistProvider,
} from './providers/registry.js';
export {
  providerCatalogItemSchema,
  providerDealSchema,
  validateProviderCatalogItem,
  validateProviderDeal,
  type ProviderCatalogItem,
  type ProviderDeal,
} from './providers/contracts.js';
export {
  requestProviderJson,
  type ProviderRequestDependencies,
  type ProviderRequestOptions,
} from './providers/request-policy.js';
export {
  CatalogRepository,
  type NewEdition,
  type NewGame,
  type NewProduct,
  type NewRelease,
  type ProductListFilters,
  type ProviderProductIdentity,
  type ProviderProductMapping,
} from './catalog-repository.js';
export {
  catalogIdSchema,
  compositionComponentTypes,
  editionInputSchema,
  gameInputSchema,
  platformFamilies,
  productCompositionInputSchema,
  productCompositionsInputSchema,
  productDistributions,
  productInputSchema,
  providerProductMappingInputSchema,
  providerProductMappingStates,
  releaseInputSchema,
  validateCatalogInput,
  type CatalogId,
  type EditionInput,
  type GameInput,
  type PlatformFamily,
  type ProductCompositionInput,
  type ProductDistribution,
  type ProductInput,
  type ProviderProductMappingInput,
  type ReleaseInput,
} from './catalog.js';
export { AppError, type ErrorCode } from './errors.js';
export { Money, type MoneyAmount } from './money.js';
export { openDatabase, type Migration, type OpenDatabaseOptions } from './persistence/sqlite.js';
export { SettingsStore, type SettingKey, type Settings } from './settings.js';
