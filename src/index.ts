export { loadConfig, type AppConfig, type ConfigOverrides } from './config.js';
export { createCoreServices, type Clock, type CoreServices } from './core-services.js';
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
