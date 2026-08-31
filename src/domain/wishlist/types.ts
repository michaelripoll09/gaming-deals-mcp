import { z } from 'zod';
import { moneySchema } from '../offers/types.js';

export const wishlistPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const nullableNotesSchema = z.string().max(2_000).nullable().optional().default(null);

export const wishlistEntrySchema = z.object({
  id: z.uuid(),
  productVariantId: z.uuid(),
  priority: wishlistPrioritySchema,
  targetPrice: moneySchema.nullable().optional().default(null),
  notes: nullableNotesSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type WishlistPriority = z.infer<typeof wishlistPrioritySchema>;
export type WishlistEntry = z.infer<typeof wishlistEntrySchema>;