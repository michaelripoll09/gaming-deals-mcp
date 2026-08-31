import { ZodError } from 'zod';
import { normalizedProviderSyncSchema, type DealProvider } from '../domain/providers/contracts.js';
import { PublicError } from '../errors/public-error.js';
import type { CatalogRepository, OfferRepository, SyncSummary, TransactionManager } from './ports.js';

export async function syncProvider(input: {
  provider: DealProvider;
  catalogRepository: CatalogRepository;
  offerRepository: OfferRepository;
  transactionManager: TransactionManager;
  country: string;
  comparisonCurrency: string;
  observedAt: string;
}): Promise<SyncSummary> {
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

  try {
    const observationCount = input.transactionManager.run(() => {
      input.catalogRepository.upsert(parsed.data.catalog, input.observedAt);
      input.offerRepository.upsertListings(parsed.data.listings);
      return input.offerRepository.upsertCurrentAndAppendObservations(parsed.data.offers, input.country);
    });

    return {
      catalogCount: parsed.data.catalog.length,
      listingCount: parsed.data.listings.length,
      offerCount: parsed.data.offers.length,
      observationCount,
    };
  } catch (error) {
    throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
  }
}
