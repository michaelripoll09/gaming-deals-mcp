import { AppError } from './errors.js';
import { z } from 'zod';

/** Opaque identity for entities in the canonical catalog. */
export const catalogIdSchema = z.string().trim().min(1).brand<'CatalogId'>();
export type CatalogId = z.infer<typeof catalogIdSchema>;

/** Parse domain input without exposing schema diagnostics or submitted values. */
export function validateCatalogInput<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AppError('INPUT_INVALID', 'Catalog input is invalid');
    }
    throw error;
  }
}

const nonEmptyTrimmedTextSchema = z.string().trim().min(1);

export const gameInputSchema = z
  .object({
    id: catalogIdSchema,
    canonicalTitle: nonEmptyTrimmedTextSchema,
  })
  .strict();
export type GameInput = z.infer<typeof gameInputSchema>;

export const releaseInputSchema = z
  .object({
    id: catalogIdSchema,
    gameId: catalogIdSchema,
    title: nonEmptyTrimmedTextSchema,
  })
  .strict();
export type ReleaseInput = z.infer<typeof releaseInputSchema>;

export const editionInputSchema = z
  .object({
    id: catalogIdSchema,
    releaseId: catalogIdSchema,
    name: nonEmptyTrimmedTextSchema,
  })
  .strict();
export type EditionInput = z.infer<typeof editionInputSchema>;

export const platformFamilies = ['pc', 'playstation', 'xbox', 'nintendo'] as const;
export const platformFamilySchema = z.enum(platformFamilies);
export type PlatformFamily = z.infer<typeof platformFamilySchema>;

export const productDistributions = [
  'digital_storefront',
  'digital_key',
  'physical_new',
  'physical_used',
  'subscription_access',
] as const;
export const productDistributionSchema = z.enum(productDistributions);
export type ProductDistribution = z.infer<typeof productDistributionSchema>;

export const productInputSchema = z
  .object({
    id: catalogIdSchema,
    editionId: catalogIdSchema,
    platform: z
      .object({
        family: platformFamilySchema,
        /** Hardware/platform variant such as PS5, Switch, or steam-compatible. */
        variant: z.string().trim().min(1).optional(),
      })
      .strict(),
    distribution: productDistributionSchema,
  })
  .strict();
export type ProductInput = z.infer<typeof productInputSchema>;

export const compositionComponentTypes = [
  'base_game',
  'dlc',
  'add_on',
  'soundtrack',
  'virtual_currency',
  'other',
] as const;
export const compositionComponentTypeSchema = z.enum(compositionComponentTypes);

export const productCompositionInputSchema = z
  .object({
    parentProductId: catalogIdSchema,
    componentProductId: catalogIdSchema,
    quantity: z.number().int().positive(),
    componentType: compositionComponentTypeSchema,
    requiredForCompleteness: z.boolean(),
  })
  .strict()
  .refine((composition) => composition.parentProductId !== composition.componentProductId, {
    message: 'A product cannot contain itself',
    path: ['componentProductId'],
  });
export type ProductCompositionInput = z.infer<typeof productCompositionInputSchema>;

export const productCompositionsInputSchema = z
  .array(productCompositionInputSchema)
  .superRefine((compositions, context) => {
    const seen = new Set<string>();
    compositions.forEach((composition, index) => {
      const pair = `${composition.parentProductId}\u0000${composition.componentProductId}`;
      if (seen.has(pair)) {
        context.addIssue({
          code: 'custom',
          message: 'A product composition pair may appear only once',
          path: [index, 'componentProductId'],
        });
      }
      seen.add(pair);
    });
  });

export const providerProductMappingStates = [
  'verified',
  'probable',
  'ambiguous',
  'unmatched',
] as const;
export const providerProductMappingStateSchema = z.enum(providerProductMappingStates);

const providerIdentitySchema = {
  providerId: z.string().trim().min(1),
  /** Provider-owned identity, intentionally not branded as a canonical catalog ID. */
  providerProductId: z.string().trim().min(1),
};

export const providerProductMappingInputSchema = z.discriminatedUnion('state', [
  z
    .object({
      ...providerIdentitySchema,
      state: z.literal('verified'),
      productId: catalogIdSchema,
    })
    .strict(),
  z
    .object({
      ...providerIdentitySchema,
      state: z.literal('probable'),
      productId: catalogIdSchema,
    })
    .strict(),
  z
    .object({
      ...providerIdentitySchema,
      state: z.literal('ambiguous'),
      productId: catalogIdSchema,
    })
    .strict(),
  z
    .object({
      ...providerIdentitySchema,
      state: z.literal('unmatched'),
      productId: z.never().optional(),
    })
    .strict(),
]);
export type ProviderProductMappingInput = z.infer<typeof providerProductMappingInputSchema>;
