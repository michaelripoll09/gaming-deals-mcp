import { z } from 'zod';
import { catalogEntrySchema } from '../catalog/types.js';
import {
  offerSchema,
  providerListingSchema,
  retailerClassSchema,
  sourceConfidenceSchema,
} from '../offers/types.js';
import type { RetailerClass, SourceConfidence } from '../offers/types.js';

export const authenticationSchema = z.enum(['none', 'api_key']);

export const providerCapabilitySchema = z.object({
  providerId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  retailerClass: retailerClassSchema,
  sourceConfidence: sourceConfidenceSchema,
  supportedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  authentication: authenticationSchema,
  enabledByDefault: z.boolean(),
}).strict();

export const normalizedProviderSyncSchema = z.object({
  catalog: z.array(catalogEntrySchema).min(1),
  listings: z.array(providerListingSchema).min(1),
  offers: z.array(offerSchema).min(1),
}).strict().superRefine((payload, context) => {
  const catalogVariantIds = new Set(payload.catalog.map((entry) => entry.productVariant.id));
  const listingIds = new Set(payload.listings.map((listing) => listing.id));

  for (const [index, listing] of payload.listings.entries()) {
    if (listing.productVariantId !== null && !catalogVariantIds.has(listing.productVariantId)) {
      context.addIssue({
        code: 'custom',
        path: ['listings', index, 'productVariantId'],
        message: 'Listing must reference a product variant in catalog',
      });
    }
    if (listing.mappingState === 'verified' && listing.productVariantId === null) {
      context.addIssue({
        code: 'custom',
        path: ['listings', index, 'productVariantId'],
        message: 'Verified listing must reference a product variant',
      });
    }
  }

  for (const [index, offer] of payload.offers.entries()) {
    if (!listingIds.has(offer.providerListingId)) {
      context.addIssue({
        code: 'custom',
        path: ['offers', index, 'providerListingId'],
        message: 'Offer must reference a listing in this sync',
      });
    }
  }
});

export type Authentication = z.infer<typeof authenticationSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type NormalizedProviderSync = z.infer<typeof normalizedProviderSyncSchema>;

export interface DealProvider {
  readonly capability: {
    providerId: string;
    displayName: string;
    retailerClass: RetailerClass;
    sourceConfidence: SourceConfidence;
    supportedCountries: string[];
    authentication: Authentication;
    enabledByDefault: boolean;
  };
  sync(input: { country: string; comparisonCurrency: string; now: string }): Promise<unknown>;
}
