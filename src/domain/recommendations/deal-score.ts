import type { PurchaseAccess } from '../access/types.js';
import type { ProductVariant } from '../catalog/types.js';
import type { Money, Offer, RetailerClass, SourceConfidence } from '../offers/types.js';
import type { WishlistEntry } from '../wishlist/types.js';

export type DealVerdict = 'exceptional_buy' | 'buy' | 'good_deal' | 'neutral' | 'wait' | 'skip';

export interface DealScoreContribution {
  readonly factor: string;
  readonly points: number;
  readonly rationale: string;
}

export interface DealScoreCandidate {
  wishlistEntry: WishlistEntry;
  productVariant: ProductVariant;
  offer: Offer;
  historicalLow: Money | null;
  purchaseAccess: PurchaseAccess;
  evaluatedAt: string;
  comparisonCurrency: string;
}

export interface DealScoreResult {
  readonly score: number;
  readonly verdict: DealVerdict;
  readonly contributions: readonly DealScoreContribution[];
  readonly positiveFactors: readonly DealScoreContribution[];
  readonly negativeFactors: readonly DealScoreContribution[];
  readonly explanation: string;
}

export interface DealScorePolicy {
  evaluate(candidate: DealScoreCandidate): DealScoreResult;
}

/** Fixed Deal Score v1 weights. Policies may receive this value explicitly in tests. */
export interface DealScoreV1Constants {
  readonly priceHistory: Readonly<{ atOrBelowLow: number; withinFivePercent: number; withinFifteenPercent: number; unavailable: number }>;
  readonly priority: Readonly<Record<WishlistEntry['priority'], number>>;
  readonly target: Readonly<{ atOrBelowTarget: number; withinTenPercent: number; unavailableOrAbove: number }>;
  readonly confidence: Readonly<Record<SourceConfidence, number>>;
  readonly retailer: Readonly<Record<RetailerClass, number>>;
  readonly freshness: Readonly<{ withinTwentyFourHours: number; withinSeventyTwoHours: number; older: number }>;
  readonly temporaryAccess: number;
}

export const DEAL_SCORE_V1_CONSTANTS: DealScoreV1Constants = deepFreeze({
  priceHistory: { atOrBelowLow: 40, withinFivePercent: 30, withinFifteenPercent: 20, unavailable: 10 },
  priority: { 1: 5, 2: 15, 3: 25 },
  target: { atOrBelowTarget: 20, withinTenPercent: 10, unavailableOrAbove: 0 },
  confidence: { high: 5, medium: 3, low: 1 },
  retailer: { first_party_storefront: 5, authorized_store: 4, physical_retailer: 3, marketplace: 1 },
  freshness: { withinTwentyFourHours: 5, withinSeventyTwoHours: 3, older: 0 },
  temporaryAccess: -45,
});

export class DealScoreV1Policy implements DealScorePolicy {
  private readonly constants: DealScoreV1Constants;

  constructor(constants: DealScoreV1Constants = DEAL_SCORE_V1_CONSTANTS) {
    this.constants = snapshotConstants(constants);
  }

  evaluate(candidate: DealScoreCandidate): DealScoreResult {
    if (candidate.purchaseAccess.kind === 'owned') {
      throw new Error('Owned candidates must be excluded before deal scoring');
    }

    const comparisonCurrency = candidate.comparisonCurrency.trim().toUpperCase();
    const finalPrice = comparisonFinalPrice(candidate.offer, comparisonCurrency);
    assertSafeMoney(finalPrice);
    if (candidate.historicalLow?.currency === comparisonCurrency) assertSafeMoney(candidate.historicalLow);
    if (candidate.wishlistEntry.targetPrice?.currency === comparisonCurrency) assertSafeMoney(candidate.wishlistEntry.targetPrice);
    const evaluatedAt = epochFor(candidate.evaluatedAt, 'evaluation time');
    const contributions = [
      priceHistoryContribution(finalPrice, candidate.historicalLow, comparisonCurrency, this.constants),
      priorityContribution(candidate.wishlistEntry.priority, this.constants),
      targetContribution(finalPrice, candidate.wishlistEntry.targetPrice, comparisonCurrency, this.constants),
      confidenceContribution(candidate.offer.sourceConfidence, this.constants),
      retailerContribution(candidate.offer.retailerClass, this.constants),
      freshnessContribution(candidate.offer.observedAt, evaluatedAt, this.constants),
    ];

    if (candidate.purchaseAccess.kind === 'temporary_access') {
      contributions.push({
        factor: 'temporary_access',
        points: this.constants.temporaryAccess,
        rationale: 'Temporary access is active.',
      });
    }

    const score = clamp(contributions.reduce((total, { points }) => total + points, 0), 0, 100);
    const verdict = verdictFor(score);
    const immutableContributions = immutableContributionsFor(contributions);
    const positiveFactors = immutableContributionsFor(contributions.filter(({ points }) => points > 0));
    const negativeFactors = immutableContributionsFor(contributions.filter(({ points }) => points < 0));

    return Object.freeze({
      score,
      verdict,
      contributions: immutableContributions,
      positiveFactors,
      negativeFactors,
      explanation: `Deal score: ${score}/100 (${verdict}). Product variant: ${candidate.productVariant.id}. ${contributions.map(({ rationale }) => rationale).join(' ')}`,
    });
  }
}

export function verdictFor(score: number): DealVerdict {
  if (score >= 90) return 'exceptional_buy';
  if (score >= 75) return 'buy';
  if (score >= 60) return 'good_deal';
  if (score >= 40) return 'neutral';
  if (score >= 20) return 'wait';
  return 'skip';
}

function comparisonFinalPrice(offer: Offer, comparisonCurrency: string): Money {
  if (offer.normalizedFinalPrice === null || offer.normalizedFinalPrice.currency !== comparisonCurrency) {
    throw new Error(`A reliable ${comparisonCurrency} final price is required before deal scoring`);
  }
  return offer.normalizedFinalPrice;
}

function priceHistoryContribution(
  finalPrice: Money,
  historicalLow: Money | null,
  comparisonCurrency: string,
  constants: DealScoreV1Constants,
): DealScoreContribution {
  if (historicalLow === null || historicalLow.currency !== comparisonCurrency) {
    return { factor: 'price_history', points: constants.priceHistory.unavailable, rationale: 'No comparable price history is available.' };
  }
  if (isAtMost(finalPrice.amountMinor, historicalLow.amountMinor)) {
    return { factor: 'price_history', points: constants.priceHistory.atOrBelowLow, rationale: 'Current final price is at or below the historical low.' };
  }
  if (isWithinPercentAbove(finalPrice.amountMinor, historicalLow.amountMinor, 5)) {
    return { factor: 'price_history', points: constants.priceHistory.withinFivePercent, rationale: 'Current final price is within 5% above the historical low.' };
  }
  if (isWithinPercentAbove(finalPrice.amountMinor, historicalLow.amountMinor, 15)) {
    return { factor: 'price_history', points: constants.priceHistory.withinFifteenPercent, rationale: 'Current final price is within 15% above the historical low.' };
  }
  return { factor: 'price_history', points: constants.priceHistory.unavailable, rationale: 'Current final price is more than 15% above the historical low.' };
}

function priorityContribution(priority: WishlistEntry['priority'], constants: DealScoreV1Constants): DealScoreContribution {
  return { factor: 'wishlist_priority', points: constants.priority[priority], rationale: `Wishlist priority ${priority}.` };
}

function targetContribution(
  finalPrice: Money,
  targetPrice: Money | null,
  comparisonCurrency: string,
  constants: DealScoreV1Constants,
): DealScoreContribution {
  if (targetPrice === null) {
    return { factor: 'target_price', points: constants.target.unavailableOrAbove, rationale: 'No target price is set.' };
  }
  if (targetPrice.currency !== comparisonCurrency) {
    return {
      factor: 'target_price',
      points: constants.target.unavailableOrAbove,
      rationale: `Target price is in ${targetPrice.currency}, not comparison currency ${comparisonCurrency}.`,
    };
  }
  if (isAtMost(finalPrice.amountMinor, targetPrice.amountMinor)) {
    return { factor: 'target_price', points: constants.target.atOrBelowTarget, rationale: 'Current final price is at or below the target price.' };
  }
  if (isWithinPercentAbove(finalPrice.amountMinor, targetPrice.amountMinor, 10)) {
    return { factor: 'target_price', points: constants.target.withinTenPercent, rationale: 'Current final price is within 10% above the target price.' };
  }
  return { factor: 'target_price', points: constants.target.unavailableOrAbove, rationale: 'Current final price is more than 10% above the target price.' };
}

function confidenceContribution(confidence: SourceConfidence, constants: DealScoreV1Constants): DealScoreContribution {
  return { factor: 'source_confidence', points: constants.confidence[confidence], rationale: `Source confidence is ${confidence}.` };
}

function retailerContribution(retailerClass: RetailerClass, constants: DealScoreV1Constants): DealScoreContribution {
  return { factor: 'retailer_class', points: constants.retailer[retailerClass], rationale: `Retailer class is ${retailerClass}.` };
}

function freshnessContribution(observedAt: string, evaluatedAt: number, constants: DealScoreV1Constants): DealScoreContribution {
  const ageMilliseconds = Math.max(0, evaluatedAt - epochFor(observedAt, 'offer observation time'));
  if (ageMilliseconds <= 24 * 60 * 60 * 1_000) {
    return { factor: 'freshness', points: constants.freshness.withinTwentyFourHours, rationale: 'Offer was observed within 24 hours.' };
  }
  if (ageMilliseconds <= 72 * 60 * 60 * 1_000) {
    return { factor: 'freshness', points: constants.freshness.withinSeventyTwoHours, rationale: 'Offer was observed within 72 hours.' };
  }
  return { factor: 'freshness', points: constants.freshness.older, rationale: 'Offer was observed more than 72 hours ago.' };
}

function isAtMost(left: number, right: number): boolean {
  return BigInt(left) <= BigInt(right);
}

function isWithinPercentAbove(priceMinor: number, baselineMinor: number, percent: number): boolean {
  return BigInt(priceMinor) * 100n <= BigInt(baselineMinor) * BigInt(100 + percent);
}

function assertSafeMoney(money: Money): void {
  if (!Number.isSafeInteger(money.amountMinor)) {
    throw new Error('Minor-unit amount must be a safe integer');
  }
}

function immutableContributionsFor(contributions: DealScoreContribution[]): readonly DealScoreContribution[] {
  return Object.freeze(contributions.map((contribution) => Object.freeze({ ...contribution })));
}

function snapshotConstants(constants: DealScoreV1Constants): DealScoreV1Constants {
  return deepFreeze({
    priceHistory: { ...constants.priceHistory },
    priority: { ...constants.priority },
    target: { ...constants.target },
    confidence: { ...constants.confidence },
    retailer: { ...constants.retailer },
    freshness: { ...constants.freshness },
    temporaryAccess: constants.temporaryAccess,
  });
}

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

function epochFor(timestamp: string, label: string): number {
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch)) throw new Error(`Invalid ${label}`);
  return epoch;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
