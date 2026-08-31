import type { Offer, ProviderListing } from '../offers/types.js';

export interface EligibilityDecision {
  eligible: boolean;
  blockers: string[];
  cautions: string[];
}

export function evaluateEligibility(input: {
  listing: ProviderListing;
  offer: Offer;
  country: string;
  comparisonCurrency: string;
}): EligibilityDecision {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const country = input.country.trim().toUpperCase();
  const comparisonCurrency = input.comparisonCurrency.trim().toUpperCase();

  if (input.listing.mappingState !== 'verified') {
    blockers.push('Mapping is not verified');
  }

  if (input.offer.regionStatus === 'incompatible') {
    blockers.push(`Offer is incompatible with ${country}`);
  }

  const finalPrice = input.offer.normalizedFinalPrice;
  if (finalPrice === null || finalPrice.currency !== comparisonCurrency) {
    blockers.push(`Reliable ${comparisonCurrency} final price is unavailable`);
  }

  if (input.offer.regionStatus === 'unknown') {
    cautions.push('Region compatibility is unknown');
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    cautions,
  };
}