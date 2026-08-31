import { describe, expect, test } from 'vitest';
import { gameSchema, productVariantSchema, releaseSchema, editionSchema } from '../../src/domain/catalog/types.js';
import { moneySchema } from '../../src/domain/offers/types.js';
import { wishlistEntrySchema } from '../../src/domain/wishlist/types.js';

describe('catalog domain schemas', () => {
  test('accepts a canonical PC digital product variant', () => {
    const result = productVariantSchema.safeParse({
      id: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
      editionId: '2af7f7a1-236a-4da6-b4d4-7793d8f8b4f7',
      platform: 'pc',
      distribution: 'digital_storefront',
      regionCode: 'CO',
    });
    expect(result.success).toBe(true);
  });

  test('rejects an unsupported platform', () => {
    const result = productVariantSchema.safeParse({
      id: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
      editionId: '2af7f7a1-236a-4da6-b4d4-7793d8f8b4f7',
      platform: 'console',
      distribution: 'digital_storefront',
      regionCode: 'CO',
    });
    expect(result.success).toBe(false);
  });

  test('rejects money with a lowercase currency', () => {
    expect(moneySchema.safeParse({ amountMinor: 100, currency: 'cop' }).success).toBe(false);
  });
});

describe('wishlistEntrySchema', () => {
  const validEntry = {
    id: '6c86d8de-9f26-494f-9462-e2f74b00b0fb',
    productVariantId: 'a0f9aa09-05e7-4f0e-8d9f-ad907e854c3c',
    priority: 1,
    targetPrice: null,
    notes: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  };

  test('accepts a nullable target price and notes', () => {
    expect(wishlistEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  test('rejects notes longer than 2,000 characters', () => {
    expect(wishlistEntrySchema.safeParse({ ...validEntry, notes: 'x'.repeat(2001) }).success).toBe(false);
  });
});