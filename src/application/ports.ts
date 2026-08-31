import type { CatalogEntry, ProductVariant } from '../domain/catalog/types.js';
import type { Offer, PriceObservation, ProviderListing } from '../domain/offers/types.js';
import type { WishlistEntry } from '../domain/wishlist/types.js';

export interface CatalogRepository {
  upsert(entries: CatalogEntry[], createdAt: string): void;
  search(query: string): ProductVariant[];
  findProductVariant(productVariantId: string): ProductVariant | null;
}

export interface OfferCandidate {
  listing: ProviderListing;
  offer: Offer;
}

export interface OfferRepository {
  upsertListings(listings: ProviderListing[]): void;
  upsertCurrentAndAppendObservations(offers: Offer[], country: string): number;
  listCandidatesForProductVariant(productVariantId: string, country: string): OfferCandidate[];
  listPriceHistory(productVariantId: string): PriceObservation[];
}

export interface WishlistRepository {
  create(entry: WishlistEntry): WishlistEntry;
  list(): WishlistEntry[];
  update(entry: WishlistEntry): WishlistEntry | null;
  remove(wishlistEntryId: string): boolean;
}

export interface TransactionManager {
  run<T>(work: () => T): T;
}

export interface SyncSummary {
  catalogCount: number;
  listingCount: number;
  offerCount: number;
  observationCount: number;
}
