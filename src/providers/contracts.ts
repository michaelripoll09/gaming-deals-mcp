import { AppError } from '../errors.js';
import { Money } from '../money.js';
import { platformFamilySchema, productDistributionSchema } from '../catalog.js';
import { z } from 'zod';

const providerCatalogItemInputSchema = z
  .object({
    providerProductId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    platform: z
      .object({
        family: platformFamilySchema,
        variant: z.string().trim().min(1).optional(),
      })
      .strict(),
    distribution: productDistributionSchema,
  })
  .strict();

export const providerCatalogItemSchema = providerCatalogItemInputSchema.transform(
  ({ platform, ...item }) => Object.freeze({ ...item, platform: Object.freeze({ ...platform }) }),
);
export type ProviderCatalogItem = z.output<typeof providerCatalogItemSchema>;

const offerUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
    } catch {
      return false;
    }
  });

const providerDealInputSchema = z
  .object({
    providerOfferId: z.string().trim().min(1),
    providerProductId: z.string().trim().min(1),
    priceOriginal: z
      .object({
        amountMinor: z.number().int().safe(),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .refine((price) => {
        try {
          Money.create(price.amountMinor, price.currency);
          return true;
        } catch {
          return false;
        }
      }),
    offerUrl: offerUrlSchema,
  })
  .strict();

export const providerDealSchema = providerDealInputSchema.transform(({ priceOriginal, ...deal }) =>
  Object.freeze({
    ...deal,
    priceOriginal: Money.create(priceOriginal.amountMinor, priceOriginal.currency),
  }),
);
export type ProviderDeal = z.output<typeof providerDealSchema>;

export function validateProviderCatalogItem(input: unknown): ProviderCatalogItem {
  try {
    return providerCatalogItemSchema.parse(input);
  } catch {
    throw new AppError('INPUT_INVALID', 'Provider catalog item is invalid');
  }
}

export function validateProviderDeal(input: unknown): ProviderDeal {
  try {
    return providerDealSchema.parse(input);
  } catch {
    throw new AppError('INPUT_INVALID', 'Provider deal is invalid');
  }
}
