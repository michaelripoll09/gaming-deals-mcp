import { z } from 'zod';

export const platformSchema = z.literal('pc');
export const distributionSchema = z.enum(['digital_storefront', 'digital_key']);
const regionCodeSchema = z.string().trim().min(1).nullable();

export const gameSchema = z.object({
  id: z.uuid(),
  canonicalTitle: z.string().trim().min(1),
});

export const releaseSchema = z.object({
  id: z.uuid(),
  gameId: z.uuid(),
  title: z.string().trim().min(1),
  releaseYear: z.number().int(),
});

export const editionSchema = z.object({
  id: z.uuid(),
  releaseId: z.uuid(),
  name: z.string().trim().min(1),
});

export const productVariantSchema = z.object({
  id: z.uuid(),
  editionId: z.uuid(),
  platform: platformSchema,
  distribution: distributionSchema,
  regionCode: regionCodeSchema,
});

export type Platform = z.infer<typeof platformSchema>;
export type Distribution = z.infer<typeof distributionSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type Edition = z.infer<typeof editionSchema>;
export type ProductVariant = z.infer<typeof productVariantSchema>;

/** The canonical chain a provider sync contributes to the catalog. */
export const catalogEntrySchema = z.object({
  game: gameSchema,
  release: releaseSchema,
  edition: editionSchema,
  productVariant: productVariantSchema,
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;