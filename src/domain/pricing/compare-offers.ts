import type { ProductVariant } from '../catalog/types.js';
import type {
  Money,
  Offer,
  PriceObservation,
  ProviderListing,
  RetailerClass,
  SourceConfidence,
} from '../offers/types.js';
import { evaluateEligibility } from './eligibility.js';

export interface OfferComparisonResult {
  selected: { listing: ProviderListing; offer: Offer } | null;
  positiveFactors: string[];
  negativeFactors: string[];
  blockers: Array<{ offerId: string; reasons: string[] }>;
  explanation: string;
}

type Candidate = { listing: ProviderListing; offer: Offer };
type EligibleCandidate = Candidate & { cautions: string[] };

const confidenceRank: Record<SourceConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const retailerRank: Record<RetailerClass, number> = {
  first_party_storefront: 0,
  authorized_store: 1,
  physical_retailer: 2,
  marketplace: 3,
};

export function selectBestOffer(input: {
  productVariant: ProductVariant;
  candidates: Candidate[];
  country: string;
  comparisonCurrency: string;
  history: PriceObservation[];
}): OfferComparisonResult {
  const country = input.country.trim().toUpperCase();
  const comparisonCurrency = input.comparisonCurrency.trim().toUpperCase();
  const blockers: Array<{ offerId: string; reasons: string[] }> = [];
  const eligible: EligibleCandidate[] = [];

  for (const candidate of input.candidates) {
    const decision = evaluateEligibility({
      ...candidate,
      country,
      comparisonCurrency,
    });

    if (!decision.eligible) {
      blockers.push({ offerId: candidate.offer.id, reasons: [...decision.blockers] });
      continue;
    }

    eligible.push({ ...candidate, cautions: [...decision.cautions] });
  }

  const selected = eligible.sort(compareCandidates)[0];
  if (selected === undefined) {
    return {
      selected: null,
      positiveFactors: [],
      negativeFactors: [],
      blockers,
      explanation: blockers.length === 0
        ? `No eligible verified offer is available for ${country}.`
        : `No eligible verified offer is available for ${country}. ${formatExclusions(blockers)}`,
    };
  }

  const positiveFactors = positiveFactorsFor(selected, country, comparisonCurrency);
  const negativeFactors = negativeFactorsFor(selected);
  const historyLow = normalizedHistoryLow(input.history, selected.offer.id, comparisonCurrency);

  return {
    selected: cloneCandidate(selected),
    positiveFactors,
    negativeFactors,
    blockers,
    explanation: buildExplanation({
      productVariant: input.productVariant,
      candidate: selected,
      country,
      comparisonCurrency,
      historyLow,
      positiveFactors,
      negativeFactors,
      blockers,
    }),
  };
}

function compareCandidates(left: EligibleCandidate, right: EligibleCandidate): number {
  const finalPriceDifference = finalPriceMinor(left.offer) - finalPriceMinor(right.offer);
  if (finalPriceDifference !== 0) {
    return finalPriceDifference;
  }

  const confidenceDifference = confidenceRank[left.offer.sourceConfidence] - confidenceRank[right.offer.sourceConfidence];
  if (confidenceDifference !== 0) {
    return confidenceDifference;
  }

  const retailerDifference = retailerRank[left.offer.retailerClass] - retailerRank[right.offer.retailerClass];
  if (retailerDifference !== 0) {
    return retailerDifference;
  }

  return left.offer.id < right.offer.id ? -1 : left.offer.id > right.offer.id ? 1 : 0;
}

function finalPriceMinor(offer: Offer): number {
  if (offer.normalizedFinalPrice === null) {
    throw new Error('Eligible offers must have a normalized final price');
  }

  return offer.normalizedFinalPrice.amountMinor;
}

function positiveFactorsFor(candidate: EligibleCandidate, country: string, comparisonCurrency: string): string[] {
  const factors = [
    'Verified mapping',
    candidate.offer.regionStatus === 'compatible'
      ? `Compatible with ${country}`
      : 'Reliable final price is available',
    `Reliable ${comparisonCurrency} final price`,
  ];

  if (candidate.offer.sourceConfidence === 'high') {
    factors.push('High source confidence');
  }
  if (candidate.offer.retailerClass === 'first_party_storefront') {
    factors.push('First-party storefront retailer');
  }
  if (candidate.offer.retailerClass === 'authorized_store') {
    factors.push('Authorized-store retailer');
  }
  if (candidate.offer.shippingKnown) {
    factors.push('Shipping cost is known');
  }
  if (candidate.offer.taxesKnown) {
    factors.push('Taxes are known');
  }

  return factors;
}

function negativeFactorsFor(candidate: EligibleCandidate): string[] {
  const factors = [...candidate.cautions];

  if (candidate.offer.sourceConfidence !== 'high') {
    factors.push(`Source confidence is ${candidate.offer.sourceConfidence}`);
  }
  if (candidate.offer.retailerClass === 'marketplace') {
    factors.push('Marketplace retailer');
  }
  if (!candidate.offer.shippingKnown) {
    factors.push('Shipping cost is unknown');
  }
  if (!candidate.offer.taxesKnown) {
    factors.push('Taxes are unknown');
  }

  return factors;
}

function normalizedHistoryLow(history: PriceObservation[], offerId: string, comparisonCurrency: string): Money | null {
  const matchingPrices = history
    .filter((observation) => observation.offerId === offerId)
    .map((observation) => observation.normalizedPrice)
    .filter((price): price is Money => price !== null && price.currency === comparisonCurrency);

  if (matchingPrices.length === 0) {
    return null;
  }

  return matchingPrices.reduce((lowest, price) => (
    price.amountMinor < lowest.amountMinor ? price : lowest
  ));
}

function buildExplanation(input: {
  productVariant: ProductVariant;
  candidate: EligibleCandidate;
  country: string;
  comparisonCurrency: string;
  historyLow: Money | null;
  positiveFactors: string[];
  negativeFactors: string[];
  blockers: Array<{ offerId: string; reasons: string[] }>;
}): string {
  const { offer } = input.candidate;

  return [
    `Product variant: ${input.productVariant.id}.`,
    `Selected offer: ${offer.id}.`,
    `Original price: ${formatMoney(offer.originalPrice)}.`,
    `Normalized price: ${formatOptionalMoney(offer.normalizedPrice)}.`,
    `Normalized final price: ${formatOptionalMoney(offer.normalizedFinalPrice)}.`,
    `Region: ${offer.regionStatus} for ${input.country}.`,
    `Retailer class: ${offer.retailerClass}.`,
    `Source confidence: ${offer.sourceConfidence}.`,
    `Shipping: ${offer.shippingKnown ? 'known' : 'unknown'}; taxes: ${offer.taxesKnown ? 'known' : 'unknown'}.`,
    `Historical normalized low: ${input.historyLow === null ? 'unavailable' : formatMoney(input.historyLow)}.`,
    `Positive factors: ${input.positiveFactors.join('; ') || 'none'}.`,
    `Negative factors: ${input.negativeFactors.join('; ') || 'none'}.`,
    formatExclusions(input.blockers),
  ].join(' ');
}

function formatExclusions(blockers: Array<{ offerId: string; reasons: string[] }>): string {
  return blockers.length === 0
    ? 'Exclusions: none.'
    : `Exclusions: ${blockers.map((blocker) => `${blocker.offerId} (${blocker.reasons.join('; ')})`).join(', ')}.`;
}

function formatOptionalMoney(money: Money | null): string {
  return money === null ? 'unavailable' : formatMoney(money);
}

function formatMoney(money: Money): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
    currencyDisplay: 'code',
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;

  return formatter.format(money.amountMinor / (10 ** fractionDigits));
}

function cloneCandidate(candidate: Candidate): Candidate {
  return {
    listing: { ...candidate.listing },
    offer: {
      ...candidate.offer,
      originalPrice: { ...candidate.offer.originalPrice },
      normalizedPrice: candidate.offer.normalizedPrice === null ? null : { ...candidate.offer.normalizedPrice },
      normalizedFinalPrice: candidate.offer.normalizedFinalPrice === null
        ? null
        : { ...candidate.offer.normalizedFinalPrice },
    },
  };
}
