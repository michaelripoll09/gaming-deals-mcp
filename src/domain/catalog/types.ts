import { z } from 'zod';

export const platformSchema = z.literal('pc');
export const distributionSchema = z.enum(['digital_storefront', 'digital_key']);
const regionCodeSchema = z.string().trim().min(1).nullable();

export const gameSchema = z.object({
  id: z.uuid(),
  canonicalTitle: z.string().trim().min(1),
}).strict();

export const releaseSchema = z.object({
  id: z.uuid(),
  gameId: z.uuid(),
  title: z.string().trim().min(1),
  releaseYear: z.number().int(),
}).strict();

export const editionSchema = z.object({
  id: z.uuid(),
  releaseId: z.uuid(),
  name: z.string().trim().min(1),
}).strict();

export const productVariantSchema = z.object({
  id: z.uuid(),
  editionId: z.uuid(),
  platform: platformSchema,
  distribution: distributionSchema,
  regionCode: regionCodeSchema,
}).strict();

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
}).strict().superRefine((entry, context) => {
  if (entry.release.gameId !== entry.game.id) {
    context.addIssue({ code: 'custom', path: ['release', 'gameId'], message: 'Release must reference its game' });
  }
  if (entry.edition.releaseId !== entry.release.id) {
    context.addIssue({ code: 'custom', path: ['edition', 'releaseId'], message: 'Edition must reference its release' });
  }
  if (entry.productVariant.editionId !== entry.edition.id) {
    context.addIssue({ code: 'custom', path: ['productVariant', 'editionId'], message: 'Product variant must reference its edition' });
  }
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
