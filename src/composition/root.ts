import type { ProductVariant } from '../domain/catalog/types.js';
import type { PriceObservation } from '../domain/offers/types.js';
import type { OfferComparisonResult } from '../domain/pricing/compare-offers.js';
import type { WishlistEntry } from '../domain/wishlist/types.js';
import { PublicError } from '../errors/public-error.js';
import { CatalogService } from '../application/catalog-service.js';
import { OfferService } from '../application/offer-service.js';
import { syncProvider } from '../application/sync-provider.js';
import { WishlistService, type CreateWishlistEntryInput } from '../application/wishlist-service.js';
import { openDatabase } from '../persistence/sqlite/database.js';
import {
  SqliteCatalogRepository,
  SqliteOfferRepository,
  SqliteTransactionManager,
  SqliteWishlistRepository,
} from '../persistence/sqlite/repositories.js';
import { DeterministicDealProvider } from '../providers/deterministic/deterministic-provider.js';

export interface Application {
  syncDeterministicProvider(observedAt: string): Promise<{
    catalogCount: number;
    listingCount: number;
    offerCount: number;
    observationCount: number;
  }>;
  searchCatalog(query: string): Promise<ProductVariant[]>;
  compareProductVariant(productVariantId: string): Promise<OfferComparisonResult>;
  listPriceHistory(productVariantId: string): Promise<PriceObservation[]>;
  createWishlistEntry(input: CreateWishlistEntryInput): Promise<WishlistEntry>;
  listWishlistEntries(): Promise<WishlistEntry[]>;
  updateWishlistEntry(entry: WishlistEntry): Promise<WishlistEntry | null>;
  removeWishlistEntry(wishlistEntryId: string): Promise<boolean>;
  close(): void;
}

export function createApplication(input: {
  databasePath: string;
  country: string;
  comparisonCurrency: string;
}): Application {
  const country = normalizeCountry(input.country);
  const comparisonCurrency = normalizeCurrency(input.comparisonCurrency);
  let opened: ReturnType<typeof openDatabase>;

  try {
    opened = openDatabase(input.databasePath);
  } catch (error) {
    throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
  }

  const catalogRepository = new SqliteCatalogRepository(opened.database);
  const offerRepository = new SqliteOfferRepository(opened.database);
  const wishlistRepository = new SqliteWishlistRepository(opened.database);
  const transactionManager = new SqliteTransactionManager(opened.database);
  const catalogService = new CatalogService(catalogRepository);
  const offerService = new OfferService(catalogRepository, offerRepository, country, comparisonCurrency);
  const wishlistService = new WishlistService(wishlistRepository);
  const deterministicProvider = new DeterministicDealProvider();

  return {
    syncDeterministicProvider: (observedAt) => syncProvider({
      provider: deterministicProvider,
      catalogRepository,
      offerRepository,
      transactionManager,
      country,
      comparisonCurrency,
      observedAt,
    }),
    searchCatalog: (query) => catalogService.search(query),
    compareProductVariant: (productVariantId) => offerService.compareProductVariant(productVariantId),
    listPriceHistory: (productVariantId) => offerService.listPriceHistory(productVariantId),
    createWishlistEntry: (wishlistInput) => wishlistService.create(wishlistInput),
    listWishlistEntries: () => wishlistService.list(),
    updateWishlistEntry: (entry) => wishlistService.update(entry),
    removeWishlistEntry: (wishlistEntryId) => wishlistService.remove(wishlistEntryId),
    close: () => opened.close(),
  };
}

function normalizeCountry(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new PublicError('invalid_configuration', 'Application configuration is invalid');
  }
  return normalized;
}

function normalizeCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new PublicError('invalid_configuration', 'Application configuration is invalid');
  }
  return normalized;
}
