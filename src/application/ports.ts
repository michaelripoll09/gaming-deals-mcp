import type { Edition, Game, ProductVariant, Release } from '../domain/catalog/types.js';
import type { Offer, PriceObservation, ProviderListing } from '../domain/offers/types.js';
import type { WishlistEntry } from '../domain/wishlist/types.js';
import type { AccessRecord } from '../domain/access/types.js';

export interface CatalogRepository {
  search(query: string): Promise<ProductVariant[]>;
  findProductVariant(productVariantId: string): Promise<ProductVariant | null>;
  upsertCatalog(input: {
    game: Game;
    release: Release;
    edition: Edition;
    productVariant: ProductVariant;
  }): Promise<void>;
}

export interface OfferRepository {
  upsertListing(listing: ProviderListing): Promise<void>;
  upsertCurrentOffer(offer: Offer): Promise<void>;
  appendPriceObservation(observation: PriceObservation): Promise<'inserted' | 'already_exists'>;
  listOffers(productVariantId: string): Promise<Offer[]>;
  listPriceHistory(productVariantId: string): Promise<PriceObservation[]>;
}

export interface WishlistRepository {
  create(entry: WishlistEntry): Promise<void>;
  list(): Promise<WishlistEntry[]>;
  update(entry: WishlistEntry): Promise<WishlistEntry | null>;
  remove(wishlistEntryId: string): Promise<boolean>;
}

export interface AccessRepository {
  create(record: AccessRecord): Promise<void>;
  list(filter?: { productVariantId?: string }): Promise<AccessRecord[]>;
  update(record: AccessRecord): Promise<AccessRecord | null>;
  remove(accessRecordId: string): Promise<boolean>;
  listByProductVariantIds(productVariantIds: string[]): Promise<AccessRecord[]>;
}

export interface SyncSummary {
  catalogCount: number;
  listingCount: number;
  offerCount: number;
  observationCount: number;
}
