import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { productVariantSchema, type CatalogEntry, type ProductVariant } from '../../domain/catalog/types.js';
import {
  offerSchema,
  priceObservationSchema,
  providerListingSchema,
  type Money,
  type Offer,
  type PriceObservation,
  type ProviderListing,
} from '../../domain/offers/types.js';
import { wishlistEntrySchema, type WishlistEntry } from '../../domain/wishlist/types.js';
import type {
  CatalogRepository,
  OfferCandidate,
  OfferRepository,
  TransactionManager,
  WishlistRepository,
} from '../../application/ports.js';

type Row = Record<string, unknown>;

export class SqliteTransactionManager implements TransactionManager {
  constructor(private readonly database: DatabaseSync) {}

  run<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original storage failure.
      }
      throw error;
    }
  }
}

export class SqliteCatalogRepository implements CatalogRepository {
  private readonly upsertGame: StatementSync;
  private readonly upsertRelease: StatementSync;
  private readonly upsertEdition: StatementSync;
  private readonly upsertProductVariant: StatementSync;
  private readonly searchProductVariants: StatementSync;
  private readonly findProductVariantById: StatementSync;

  constructor(database: DatabaseSync) {
    this.upsertGame = database.prepare(`
      INSERT INTO games (id, title, normalized_title, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        normalized_title = excluded.normalized_title
    `);
    this.upsertRelease = database.prepare(`
      INSERT INTO releases (id, game_id, title, release_date, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        game_id = excluded.game_id,
        title = excluded.title,
        release_date = excluded.release_date
    `);
    this.upsertEdition = database.prepare(`
      INSERT INTO editions (id, release_id, name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        release_id = excluded.release_id,
        name = excluded.name
    `);
    this.upsertProductVariant = database.prepare(`
      INSERT INTO product_variants (
        id, edition_id, platform, distribution_channel, created_at, region_code
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        edition_id = excluded.edition_id,
        platform = excluded.platform,
        distribution_channel = excluded.distribution_channel,
        region_code = excluded.region_code
    `);
    this.searchProductVariants = database.prepare(`
      SELECT product_variants.id, product_variants.edition_id AS editionId,
        product_variants.platform, product_variants.distribution_channel AS distribution,
        product_variants.region_code AS regionCode
      FROM product_variants
      JOIN editions ON editions.id = product_variants.edition_id
      JOIN releases ON releases.id = editions.release_id
      JOIN games ON games.id = releases.game_id
      WHERE ? = ''
        OR games.normalized_title LIKE ? ESCAPE '\\'
        OR lower(releases.title) LIKE ? ESCAPE '\\'
        OR lower(editions.name) LIKE ? ESCAPE '\\'
      ORDER BY games.normalized_title, releases.id, lower(editions.name), product_variants.id
    `);
    this.findProductVariantById = database.prepare(`
      SELECT id, edition_id AS editionId, platform,
        distribution_channel AS distribution, region_code AS regionCode
      FROM product_variants
      WHERE id = ?
    `);
  }

  upsert(entries: CatalogEntry[], createdAt: string): void {
    for (const entry of entries) {
      this.upsertGame.run(
        entry.game.id,
        entry.game.canonicalTitle,
        normalizeSearchText(entry.game.canonicalTitle),
        createdAt,
      );
      this.upsertRelease.run(
        entry.release.id,
        entry.release.gameId,
        entry.release.title,
        String(entry.release.releaseYear),
        createdAt,
      );
      this.upsertEdition.run(entry.edition.id, entry.edition.releaseId, entry.edition.name, createdAt);
      this.upsertProductVariant.run(
        entry.productVariant.id,
        entry.productVariant.editionId,
        entry.productVariant.platform,
        entry.productVariant.distribution,
        createdAt,
        entry.productVariant.regionCode,
      );
    }
  }

  search(query: string): ProductVariant[] {
    const normalized = normalizeSearchText(query);
    const pattern = `%${escapeLike(normalized)}%`;
    return this.searchProductVariants.all(normalized, pattern, pattern, pattern)
      .map((row) => mapProductVariant(asRow(row)));
  }

  findProductVariant(productVariantId: string): ProductVariant | null {
    const row = this.findProductVariantById.get(productVariantId);
    return row === undefined ? null : mapProductVariant(asRow(row));
  }
}

export class SqliteOfferRepository implements OfferRepository {
  private readonly upsertListing: StatementSync;
  private readonly upsertOffer: StatementSync;
  private readonly findCurrentOfferId: StatementSync;
  private readonly insertObservation: StatementSync;
  private readonly selectCandidates: StatementSync;
  private readonly selectPriceHistory: StatementSync;

  constructor(database: DatabaseSync) {
    this.upsertListing = database.prepare(`
      INSERT INTO provider_listings (
        id, provider_id, provider_product_id, product_variant_id, mapping_state
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        provider_product_id = excluded.provider_product_id,
        product_variant_id = excluded.product_variant_id,
        mapping_state = excluded.mapping_state
    `);
    this.upsertOffer = database.prepare(`
      INSERT INTO offers (
        id, provider_listing_id, country, original_currency, original_amount_minor,
        product_url, available, observed_at, source_observation_key,
        normalized_amount_minor, normalized_currency, normalized_final_amount_minor,
        normalized_final_currency, exchange_rate_source, converted_at, region_status,
        retailer_class, source_confidence, shipping_known, taxes_known
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_listing_id, country) DO UPDATE SET
        original_currency = excluded.original_currency,
        original_amount_minor = excluded.original_amount_minor,
        product_url = excluded.product_url,
        available = excluded.available,
        observed_at = excluded.observed_at,
        source_observation_key = excluded.source_observation_key,
        normalized_amount_minor = excluded.normalized_amount_minor,
        normalized_currency = excluded.normalized_currency,
        normalized_final_amount_minor = excluded.normalized_final_amount_minor,
        normalized_final_currency = excluded.normalized_final_currency,
        exchange_rate_source = excluded.exchange_rate_source,
        converted_at = excluded.converted_at,
        region_status = excluded.region_status,
        retailer_class = excluded.retailer_class,
        source_confidence = excluded.source_confidence,
        shipping_known = excluded.shipping_known,
        taxes_known = excluded.taxes_known
    `);
    this.findCurrentOfferId = database.prepare(`
      SELECT id FROM offers WHERE provider_listing_id = ? AND country = ?
    `);
    this.insertObservation = database.prepare(`
      INSERT INTO price_observations (
        id, offer_id, provider_listing_id, source_observation_key,
        original_amount_minor, original_currency, normalized_amount_minor,
        comparison_currency, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_listing_id, source_observation_key) DO NOTHING
    `);
    this.selectCandidates = database.prepare(`
      SELECT
        provider_listings.id AS listingId,
        provider_listings.provider_id AS providerId,
        provider_listings.provider_product_id AS providerProductId,
        provider_listings.product_variant_id AS productVariantId,
        provider_listings.mapping_state AS mappingState,
        offers.id AS offerId,
        offers.provider_listing_id AS offerProviderListingId,
        offers.source_observation_key AS sourceObservationKey,
        offers.original_amount_minor AS originalAmountMinor,
        offers.original_currency AS originalCurrency,
        offers.normalized_amount_minor AS normalizedAmountMinor,
        offers.normalized_currency AS normalizedCurrency,
        offers.normalized_final_amount_minor AS normalizedFinalAmountMinor,
        offers.normalized_final_currency AS normalizedFinalCurrency,
        offers.exchange_rate_source AS exchangeRateSource,
        offers.converted_at AS convertedAt,
        offers.region_status AS regionStatus,
        offers.retailer_class AS retailerClass,
        offers.source_confidence AS sourceConfidence,
        offers.shipping_known AS shippingKnown,
        offers.taxes_known AS taxesKnown,
        offers.product_url AS destinationUrl,
        offers.observed_at AS observedAt
      FROM provider_listings
      JOIN offers ON offers.provider_listing_id = provider_listings.id
      WHERE provider_listings.product_variant_id = ?
        AND offers.country = ?
        AND offers.available = 1
      ORDER BY offers.id
    `);
    this.selectPriceHistory = database.prepare(`
      SELECT price_observations.id,
        price_observations.offer_id AS offerId,
        price_observations.provider_listing_id AS providerListingId,
        price_observations.source_observation_key AS sourceObservationKey,
        price_observations.original_amount_minor AS originalAmountMinor,
        price_observations.original_currency AS originalCurrency,
        price_observations.normalized_amount_minor AS normalizedAmountMinor,
        price_observations.comparison_currency AS normalizedCurrency,
        price_observations.observed_at AS observedAt
      FROM price_observations
      JOIN provider_listings ON provider_listings.id = price_observations.provider_listing_id
      WHERE provider_listings.product_variant_id = ?
      ORDER BY price_observations.observed_at, price_observations.id
    `);
  }

  upsertListings(listings: ProviderListing[]): void {
    for (const listing of listings) {
      this.upsertListing.run(
        listing.id,
        listing.providerId,
        listing.providerProductId,
        listing.productVariantId,
        listing.mappingState,
      );
    }
  }

  upsertCurrentAndAppendObservations(offers: Offer[], country: string): number {
    let observationCount = 0;

    for (const offer of offers) {
      this.upsertOffer.run(
        offer.id,
        offer.providerListingId,
        country,
        offer.originalPrice.currency,
        offer.originalPrice.amountMinor,
        offer.destinationUrl,
        offer.observedAt,
        offer.sourceObservationKey,
        offer.normalizedPrice?.amountMinor ?? null,
        offer.normalizedPrice?.currency ?? null,
        offer.normalizedFinalPrice?.amountMinor ?? null,
        offer.normalizedFinalPrice?.currency ?? null,
        offer.exchangeRateSource,
        offer.convertedAt,
        offer.regionStatus,
        offer.retailerClass,
        offer.sourceConfidence,
        offer.shippingKnown ? 1 : 0,
        offer.taxesKnown ? 1 : 0,
      );

      const current = this.findCurrentOfferId.get(offer.providerListingId, country);
      if (current === undefined) {
        throw new Error('Current offer was not persisted');
      }
      const currentOfferId = requiredString(asRow(current), 'id');
      const inserted = this.insertObservation.run(
        observationId(offer.providerListingId, offer.sourceObservationKey),
        currentOfferId,
        offer.providerListingId,
        offer.sourceObservationKey,
        offer.originalPrice.amountMinor,
        offer.originalPrice.currency,
        offer.normalizedPrice?.amountMinor ?? null,
        offer.normalizedPrice?.currency ?? null,
        offer.observedAt,
      );
      observationCount += Number(inserted.changes);
    }

    return observationCount;
  }

  listCandidatesForProductVariant(productVariantId: string, country: string): OfferCandidate[] {
    return this.selectCandidates.all(productVariantId, country)
      .map((row) => mapOfferCandidate(asRow(row)));
  }

  listPriceHistory(productVariantId: string): PriceObservation[] {
    return this.selectPriceHistory.all(productVariantId)
      .map((row) => mapPriceObservation(asRow(row)));
  }
}

export class SqliteWishlistRepository implements WishlistRepository {
  private readonly insertEntry: StatementSync;
  private readonly selectAll: StatementSync;
  private readonly selectById: StatementSync;
  private readonly updateEntry: StatementSync;
  private readonly deleteEntry: StatementSync;

  constructor(database: DatabaseSync) {
    this.insertEntry = database.prepare(`
      INSERT INTO wishlist_entries (
        id, product_variant_id, created_at, priority,
        target_amount_minor, target_currency, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const select = `
      SELECT id, product_variant_id AS productVariantId, priority,
        target_amount_minor AS targetAmountMinor, target_currency AS targetCurrency,
        notes, created_at AS createdAt, updated_at AS updatedAt
      FROM wishlist_entries
    `;
    this.selectAll = database.prepare(`${select} ORDER BY priority, created_at, id`);
    this.selectById = database.prepare(`${select} WHERE id = ?`);
    this.updateEntry = database.prepare(`
      UPDATE wishlist_entries SET
        product_variant_id = ?,
        priority = ?,
        target_amount_minor = ?,
        target_currency = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `);
    this.deleteEntry = database.prepare('DELETE FROM wishlist_entries WHERE id = ?');
  }

  create(entry: WishlistEntry): WishlistEntry {
    this.insertEntry.run(
      entry.id,
      entry.productVariantId,
      entry.createdAt,
      entry.priority,
      entry.targetPrice?.amountMinor ?? null,
      entry.targetPrice?.currency ?? null,
      entry.notes,
      entry.updatedAt,
    );
    return this.getRequired(entry.id);
  }

  list(): WishlistEntry[] {
    return this.selectAll.all().map((row) => mapWishlistEntry(asRow(row)));
  }

  update(entry: WishlistEntry): WishlistEntry | null {
    const updated = this.updateEntry.run(
      entry.productVariantId,
      entry.priority,
      entry.targetPrice?.amountMinor ?? null,
      entry.targetPrice?.currency ?? null,
      entry.notes,
      entry.updatedAt,
      entry.id,
    );
    return Number(updated.changes) === 0 ? null : this.getRequired(entry.id);
  }

  remove(wishlistEntryId: string): boolean {
    return Number(this.deleteEntry.run(wishlistEntryId).changes) > 0;
  }

  private getRequired(wishlistEntryId: string): WishlistEntry {
    const row = this.selectById.get(wishlistEntryId);
    if (row === undefined) {
      throw new Error('Wishlist entry was not persisted');
    }
    return mapWishlistEntry(asRow(row));
  }
}

function mapProductVariant(row: Row): ProductVariant {
  return productVariantSchema.parse({
    id: row.id,
    editionId: row.editionId,
    platform: row.platform,
    distribution: row.distribution,
    regionCode: row.regionCode,
  });
}

function mapOfferCandidate(row: Row): OfferCandidate {
  const listing = providerListingSchema.parse({
    id: row.listingId,
    providerId: row.providerId,
    providerProductId: row.providerProductId,
    productVariantId: row.productVariantId,
    mappingState: row.mappingState,
  });
  const offer = offerSchema.parse({
    id: row.offerId,
    providerListingId: row.offerProviderListingId,
    sourceObservationKey: row.sourceObservationKey,
    originalPrice: mapMoney(row.originalAmountMinor, row.originalCurrency),
    normalizedPrice: mapNullableMoney(row.normalizedAmountMinor, row.normalizedCurrency),
    normalizedFinalPrice: mapNullableMoney(row.normalizedFinalAmountMinor, row.normalizedFinalCurrency),
    exchangeRateSource: row.exchangeRateSource,
    convertedAt: row.convertedAt,
    regionStatus: row.regionStatus,
    retailerClass: row.retailerClass,
    sourceConfidence: row.sourceConfidence,
    shippingKnown: row.shippingKnown === 1,
    taxesKnown: row.taxesKnown === 1,
    destinationUrl: row.destinationUrl,
    observedAt: row.observedAt,
  });
  return { listing, offer };
}

function mapPriceObservation(row: Row): PriceObservation {
  return priceObservationSchema.parse({
    id: row.id,
    offerId: row.offerId,
    providerListingId: row.providerListingId,
    sourceObservationKey: row.sourceObservationKey,
    originalPrice: mapMoney(row.originalAmountMinor, row.originalCurrency),
    normalizedPrice: mapNullableMoney(row.normalizedAmountMinor, row.normalizedCurrency),
    observedAt: row.observedAt,
  });
}

function mapWishlistEntry(row: Row): WishlistEntry {
  return wishlistEntrySchema.parse({
    id: row.id,
    productVariantId: row.productVariantId,
    priority: row.priority,
    targetPrice: mapNullableMoney(row.targetAmountMinor, row.targetCurrency),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapMoney(amountMinor: unknown, currency: unknown): Money {
  return { amountMinor: requiredNumber(amountMinor), currency: requiredStringValue(currency) };
}

function mapNullableMoney(amountMinor: unknown, currency: unknown): Money | null {
  if (amountMinor === null && currency === null) {
    return null;
  }
  return mapMoney(amountMinor, currency);
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error('Stored money amount is invalid');
  }
  return value;
}

function requiredStringValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Stored text value is invalid');
  }
  return value;
}

function requiredString(row: Row, key: string): string {
  return requiredStringValue(row[key]);
}

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored row is invalid');
  }
  return value as Row;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function observationId(providerListingId: string, sourceObservationKey: string): string {
  const bytes = createHash('sha256')
    .update(providerListingId)
    .update('\0')
    .update(sourceObservationKey)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
