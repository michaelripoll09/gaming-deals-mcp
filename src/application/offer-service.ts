import type { Offer, PriceObservation, ProviderListing } from '../domain/offers/types.js';
import { selectBestOffer, type OfferComparisonResult } from '../domain/pricing/compare-offers.js';
import { PublicError } from '../errors/public-error.js';
import type { CatalogRepository, OfferRepository } from './ports.js';

interface OfferCandidateReader {
  listOfferCandidates(productVariantId: string): Promise<Array<{ listing: ProviderListing; offer: Offer }>>;
}

export class OfferService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly offerRepository: OfferRepository & OfferCandidateReader,
    private readonly country: string,
    private readonly comparisonCurrency: string,
  ) {}

  async compareProductVariant(productVariantId: string): Promise<OfferComparisonResult> {
    try {
      const productVariant = await this.catalogRepository.findProductVariant(productVariantId);
      if (productVariant === null) {
        throw new PublicError('product_not_found', 'Product variant was not found');
      }

      return selectBestOffer({
        productVariant,
        candidates: await this.offerRepository.listOfferCandidates(productVariantId),
        country: this.country,
        comparisonCurrency: this.comparisonCurrency,
        history: await this.offerRepository.listPriceHistory(productVariantId),
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
      return await this.offerRepository.listPriceHistory(productVariantId);
    } catch (error) {
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }
}
