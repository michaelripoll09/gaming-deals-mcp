import { derivePurchaseAccess, type PurchaseAccess } from '../domain/access/types.js';
import type { ProductVariant } from '../domain/catalog/types.js';
import type { Money, Offer, ProviderListing } from '../domain/offers/types.js';
import type { DealScorePolicy, DealScoreResult } from '../domain/recommendations/deal-score.js';
import type { WishlistEntry } from '../domain/wishlist/types.js';
import { PublicError } from '../errors/public-error.js';
import type { AccessRepository, CatalogRepository, WishlistRepository } from './ports.js';
import { OfferService } from './offer-service.js';

export interface RecommendationExclusion {
  productVariantId: string;
  blockers: string[];
}

export interface Recommendation {
  wishlistEntry: WishlistEntry;
  productVariant: ProductVariant;
  selectedOffer: { listing: ProviderListing; offer: Offer };
  score: DealScoreResult;
  access: PurchaseAccess;
}

export interface WhatShouldIBuyResult {
  recommendations: Recommendation[];
  exclusions: RecommendationExclusion[];
}

export interface Application {
  whatShouldIBuy(): Promise<WhatShouldIBuyResult>;
}

export class RecommendationService implements Application {
  constructor(private readonly input: {
    wishlistRepository: WishlistRepository;
    catalogRepository: CatalogRepository;
    accessRepository: AccessRepository;
    offerService: OfferService;
    policy: DealScorePolicy;
    clock: () => string;
    comparisonCurrency: string;
  }) {}

  async whatShouldIBuy(): Promise<WhatShouldIBuyResult> {
    try {
      const wishlistEntries = await this.input.wishlistRepository.list();
      const productVariantIds = [...new Set(wishlistEntries.map((entry) => entry.productVariantId))];
      const accessRecords = await this.input.accessRepository.listByProductVariantIds(productVariantIds);
      const evaluatedAt = this.input.clock();
      const accessByProductVariantId = groupByProductVariantId(accessRecords);
      const recommendations: Recommendation[] = [];
      const exclusions: RecommendationExclusion[] = [];

      for (const wishlistEntry of wishlistEntries) {
        const access = derivePurchaseAccess(accessByProductVariantId.get(wishlistEntry.productVariantId) ?? [], evaluatedAt);
        if (access.kind === 'owned') {
          exclusions.push({ productVariantId: wishlistEntry.productVariantId, blockers: ['Product is already owned'] });
          continue;
        }

        const comparison = await this.input.offerService.compareProductVariant(wishlistEntry.productVariantId);
        if (comparison.selected === null) {
          exclusions.push({
            productVariantId: wishlistEntry.productVariantId,
            blockers: safeOfferBlockers(comparison.blockers, comparison.explanation),
          });
          continue;
        }

        const productVariant = await this.input.catalogRepository.findProductVariant(wishlistEntry.productVariantId);
        if (productVariant === null) {
          throw new PublicError('product_not_found', 'Product variant was not found');
        }

        const history = await this.input.offerService.listPriceHistory(wishlistEntry.productVariantId);
        const historicalLow = sameCurrencyHistoricalLow(history, comparison.selected.offer.id, this.input.comparisonCurrency);
        const score = this.input.policy.evaluate({
          wishlistEntry,
          productVariant,
          offer: comparison.selected.offer,
          historicalLow,
          purchaseAccess: access,
          evaluatedAt,
          comparisonCurrency: this.input.comparisonCurrency,
        });
        recommendations.push({
          wishlistEntry,
          productVariant,
          selectedOffer: comparison.selected,
          score,
          access,
        });
      }

      return {
        recommendations: recommendations.sort(compareRecommendations),
        exclusions,
      };
    } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }
}

function groupByProductVariantId(records: Awaited<ReturnType<AccessRepository['listByProductVariantIds']>>) {
  const grouped = new Map<string, typeof records>();
  for (const record of records) {
    const existing = grouped.get(record.productVariantId);
    if (existing === undefined) grouped.set(record.productVariantId, [record]);
    else existing.push(record);
  }
  return grouped;
}

function safeOfferBlockers(
  blockers: Array<{ offerId: string; reasons: string[] }>,
  explanation: string,
): string[] {
  const reasons = blockers.flatMap(({ reasons }) => reasons).filter((reason) => reason.length > 0);
  return reasons.length > 0 ? reasons : [explanation];
}

function sameCurrencyHistoricalLow(
  history: Awaited<ReturnType<OfferService['listPriceHistory']>>,
  selectedOfferId: string,
  comparisonCurrency: string,
): Money | null {
  const normalizedCurrency = comparisonCurrency.trim().toUpperCase();
  const prices = history
    .filter((observation) => observation.offerId === selectedOfferId)
    .map((observation) => observation.normalizedPrice)
    .filter((price): price is Money => price !== null && price.currency === normalizedCurrency);

  return prices.length === 0
    ? null
    : prices.reduce((lowest, price) => price.amountMinor < lowest.amountMinor ? price : lowest);
}

function compareRecommendations(left: Recommendation, right: Recommendation): number {
  const scoreDifference = right.score.score - left.score.score;
  if (scoreDifference !== 0) return scoreDifference;

  const priorityDifference = right.wishlistEntry.priority - left.wishlistEntry.priority;
  if (priorityDifference !== 0) return priorityDifference;

  return left.productVariant.id < right.productVariant.id ? -1 : left.productVariant.id > right.productVariant.id ? 1 : 0;
}
