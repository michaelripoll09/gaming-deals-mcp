import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import {
  normalizedProviderSyncSchema,
  providerCapabilitySchema,
  type DealProvider,
} from '../domain/providers/contracts.js';
import type { Offer, PriceObservation } from '../domain/offers/types.js';
import { PublicError } from '../errors/public-error.js';
import type { CatalogRepository, OfferRepository, SyncSummary } from './ports.js';

type RunInTransaction = <T>(work: () => Promise<T>) => Promise<T>;

interface CurrentOfferIdentityReader {
  findCurrentOfferId(providerListingId: string): Promise<string | null>;
}

export async function syncProvider(input: {
  provider: DealProvider;
  catalogRepository: CatalogRepository;
  offerRepository: OfferRepository & CurrentOfferIdentityReader;
  runInTransaction: RunInTransaction;
  country: string;
  comparisonCurrency: string;
  observedAt: string;
}): Promise<SyncSummary> {
  const capability = providerCapabilitySchema.safeParse(input.provider.capability);
  if (!capability.success || !capability.data.supportedCountries.includes(input.country)) {
    throw new PublicError('provider_data_invalid', 'Provider data is invalid', capability.success ? undefined : capability.error);
  }

  let unknownPayload: unknown;
  try {
    unknownPayload = await input.provider.sync({
      country: input.country,
      comparisonCurrency: input.comparisonCurrency,
      now: input.observedAt,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      throw new PublicError('provider_data_invalid', 'Provider data is invalid', error);
    }
    if (error instanceof PublicError) {
      throw error;
    }
    throw new PublicError('provider_unavailable', 'Provider is unavailable', error);
  }

  const parsed = normalizedProviderSyncSchema.safeParse(unknownPayload);
  if (!parsed.success) {
    throw new PublicError('provider_data_invalid', 'Provider data is invalid', parsed.error);
  }

  await verifyCurrentOfferIdentities(input.offerRepository, parsed.data.offers);

  try {
    const observationCount = await input.runInTransaction(async () => {
      for (const entry of parsed.data.catalog) {
        await input.catalogRepository.upsertCatalog(entry);
      }
      for (const listing of parsed.data.listings) {
        await input.offerRepository.upsertListing(listing);
      }

      let inserted = 0;
      for (const offer of parsed.data.offers) {
        await input.offerRepository.upsertCurrentOffer(offer);
        const result = await input.offerRepository.appendPriceObservation(observationFromOffer(offer));
        if (result === 'inserted') {
          inserted += 1;
        }
      }
      return inserted;
    });

    return {
      catalogCount: parsed.data.catalog.length,
      listingCount: parsed.data.listings.length,
      offerCount: parsed.data.offers.length,
      observationCount,
    };
  } catch (error) {
    if (error instanceof PublicError) {
      throw error;
    }
    throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
  }
}

async function verifyCurrentOfferIdentities(
  repository: CurrentOfferIdentityReader,
  offers: Offer[],
): Promise<void> {
  try {
    const incomingIds = new Map<string, string>();
    for (const offer of offers) {
      const incomingId = incomingIds.get(offer.providerListingId);
      if (incomingId !== undefined && incomingId !== offer.id) {
        throw new PublicError('provider_data_invalid', 'Provider data is invalid');
      }
      incomingIds.set(offer.providerListingId, offer.id);

      const currentOfferId = await repository.findCurrentOfferId(offer.providerListingId);
      if (currentOfferId !== null && currentOfferId !== offer.id) {
        throw new PublicError('provider_data_invalid', 'Provider data is invalid');
      }
    }
  } catch (error) {
    if (error instanceof PublicError) {
      throw error;
    }
    throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
  }
}

function observationFromOffer(offer: Offer): PriceObservation {
  return {
    id: observationId(offer.providerListingId, offer.sourceObservationKey),
    offerId: offer.id,
    providerListingId: offer.providerListingId,
    sourceObservationKey: offer.sourceObservationKey,
    originalPrice: { ...offer.originalPrice },
    normalizedPrice: offer.normalizedPrice === null ? null : { ...offer.normalizedPrice },
    observedAt: offer.observedAt,
  };
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
