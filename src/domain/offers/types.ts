import { z } from 'zod';

export const mappingStateSchema = z.enum(['verified', 'probable', 'ambiguous', 'unmatched']);
export const regionStatusSchema = z.enum(['compatible', 'incompatible', 'unknown']);
export const retailerClassSchema = z.enum([
  'authorized_store',
  'marketplace',
  'first_party_storefront',
  'physical_retailer',
]);
export const sourceConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const isoTimestampSchema = z.iso.datetime({ offset: true });

export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: currencySchema,
});

export const providerListingSchema = z.object({
  id: z.uuid(),
  providerId: z.string().trim().min(1),
  providerProductId: z.string().trim().min(1),
  productVariantId: z.uuid().nullable(),
  mappingState: mappingStateSchema,
});

const httpsUrlSchema = z.url().refine((value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, { message: 'URL must use HTTPS' });

export const offerSchema = z.object({
  id: z.uuid(),
  providerListingId: z.uuid(),
  sourceObservationKey: z.string().min(1),
  originalPrice: moneySchema,
  normalizedPrice: moneySchema.nullable(),
  normalizedFinalPrice: moneySchema.nullable(),
  exchangeRateSource: z.string().min(1).nullable(),
  convertedAt: isoTimestampSchema.nullable(),
  regionStatus: regionStatusSchema,
  retailerClass: retailerClassSchema,
  sourceConfidence: sourceConfidenceSchema,
  shippingKnown: z.boolean(),
  taxesKnown: z.boolean(),
  destinationUrl: httpsUrlSchema,
  observedAt: isoTimestampSchema,
});

export const priceObservationSchema = z.object({
  id: z.uuid(),
  offerId: z.uuid(),
  providerListingId: z.uuid(),
  sourceObservationKey: z.string().min(1),
  originalPrice: moneySchema,
  normalizedPrice: moneySchema.nullable(),
  observedAt: isoTimestampSchema,
});

export type MappingState = z.infer<typeof mappingStateSchema>;
export type RegionStatus = z.infer<typeof regionStatusSchema>;
export type RetailerClass = z.infer<typeof retailerClassSchema>;
export type SourceConfidence = z.infer<typeof sourceConfidenceSchema>;
export type Money = z.infer<typeof moneySchema>;
export type ProviderListing = z.infer<typeof providerListingSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type PriceObservation = z.infer<typeof priceObservationSchema>;