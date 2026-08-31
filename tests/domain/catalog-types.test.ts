import { describe, expect, test } from 'vitest';
import { catalogEntrySchema, editionSchema, gameSchema, productVariantSchema, releaseSchema } from '../../src/domain/catalog/types.js';
import { moneySchema } from '../../src/domain/offers/types.js';
import { wishlistEntrySchema } from '../../src/domain/wishlist/types.js';

const ids = {
  game: 'b8dd4e1d-c95c-4ea5-9916-8f8e11e2cf1a', release: 'd0d3c24f-23d2-4252-bd8b-51d636c1ab6f',
  edition: 'f79f8019-a877-4aa2-a6e3-4e5b8fd4cc8e', variant: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
};
const validCatalogItem = {
  game: { id: ids.game, canonicalTitle: 'Example Game' },
  release: { id: ids.release, gameId: ids.game, title: 'Example Game', releaseYear: 2024 },
  edition: { id: ids.edition, releaseId: ids.release, name: 'Standard' },
  productVariant: { id: ids.variant, editionId: ids.edition, platform: 'pc', distribution: 'digital_storefront', regionCode: 'CO' },
};
const validEntry = {
  id: '6c86d8de-9f26-494f-9462-e2f74b00b0fb', productVariantId: ids.variant, priority: 1, targetPrice: null, notes: null,
  createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
};

describe('catalog domain schemas', () => {
  test('accepts a canonical PC digital product variant', () => {
    expect(productVariantSchema.safeParse(validCatalogItem.productVariant).success).toBe(true);
  });
  test('rejects an unsupported platform', () => {
    expect(productVariantSchema.safeParse({ ...validCatalogItem.productVariant, platform: 'console' }).success).toBe(false);
  });
  test.each([
    ['release.gameId', { release: { ...validCatalogItem.release, gameId: ids.edition } }],
    ['edition.releaseId', { edition: { ...validCatalogItem.edition, releaseId: ids.game } }],
    ['productVariant.editionId', { productVariant: { ...validCatalogItem.productVariant, editionId: ids.game } }],
  ])('rejects a disconnected canonical graph when %s is mismatched', (_relation, change) => {
    expect(catalogEntrySchema.safeParse({ ...validCatalogItem, ...change }).success).toBe(false);
  });
  test.each([
    ['game', gameSchema, validCatalogItem.game], ['release', releaseSchema, validCatalogItem.release],
    ['edition', editionSchema, validCatalogItem.edition], ['product variant', productVariantSchema, validCatalogItem.productVariant],
  ])('rejects unknown keys on the %s schema', (_name, schema, value) => {
    expect(schema.safeParse({ ...value, typo: true }).success).toBe(false);
  });
  test('rejects money with a lowercase currency', () => {
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'cop' }).success).toBe(false);
  });
  test('rejects unknown money keys', () => {
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'COP', typo: true }).success).toBe(false);
  });
});

describe('wishlistEntrySchema', () => {
  test('accepts a nullable target price and notes', () => {
    expect(wishlistEntrySchema.safeParse(validEntry).success).toBe(true);
  });
  test('defaults omitted target price and notes to null', () => {
    const { targetPrice: _targetPrice, notes: _notes, ...withoutOptionalFields } = validEntry;
    const result = wishlistEntrySchema.safeParse(withoutOptionalFields);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ targetPrice: null, notes: null });
  });
  test.each([0, 4])('rejects priority %s', (priority) => {
    expect(wishlistEntrySchema.safeParse({ ...validEntry, priority }).success).toBe(false);
  });
  test('rejects an invalid created timestamp', () => {
    expect(wishlistEntrySchema.safeParse({ ...validEntry, createdAt: 'not-a-timestamp' }).success).toBe(false);
  });
  test('rejects notes longer than 2,000 characters', () => {
    expect(wishlistEntrySchema.safeParse({ ...validEntry, notes: 'x'.repeat(2001) }).success).toBe(false);
  });
  test('rejects unknown wishlist fields', () => {
    expect(wishlistEntrySchema.safeParse({ ...validEntry, typo: true }).success).toBe(false);
  });
});
