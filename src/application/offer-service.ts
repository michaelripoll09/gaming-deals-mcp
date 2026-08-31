import type { PriceObservation } from '../domain/offers/types.js';
import { selectBestOffer, type OfferComparisonResult } from '../domain/pricing/compare-offers.js';
import { PublicError } from '../errors/public-error.js';
import type { CatalogRepository, OfferRepository } from './ports.js';

export class OfferService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly offerRepository: OfferRepository,
    private readonly country: string,
    private readonly comparisonCurrency: string,
  ) {}

  async compareProductVariant(productVariantId: string): Promise<OfferComparisonResult> {
    try {
      const productVariant = this.catalogRepository.findProductVariant(productVariantId);
      if (productVariant === null) {
        throw new PublicError('product_not_found', 'Product variant was not found');
      }

      return selectBestOffer({
        productVariant,
        candidates: this.offerRepository.listCandidatesForProductVariant(productVariantId, this.country),
        country: this.country,
        comparisonCurrency: this.comparisonCurrency,
        history: this.offerRepository.listPriceHistory(productVariantId),
      });
    } catch (error) {
      if (error instanceof PublicError) {
        throw error;
      }
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }

  async listPriceHistory(productVariantId: string): Promise<PriceObservation[]> {
    try {
      return this.offerRepository.listPriceHistory(productVariantId);
    } catch (error) {
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }
}
