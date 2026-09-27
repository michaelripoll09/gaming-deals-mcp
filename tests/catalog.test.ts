import { describe, expect, it } from 'vitest';
import {
  catalogIdSchema,
  editionInputSchema,
  gameInputSchema,
  productCompositionInputSchema,
  productCompositionsInputSchema,
  productInputSchema,
  providerProductMappingInputSchema,
  releaseInputSchema,
  validateCatalogInput,
} from '../src/catalog.js';

import { AppError } from '../src/errors.js';

describe('canonical catalog contracts', () => {
  it('validates the Game → Release → Edition → Product hierarchy with opaque IDs', () => {
    const gameId = catalogIdSchema.parse('game-1');
    const releaseId = catalogIdSchema.parse('release-1');
    const editionId = catalogIdSchema.parse('edition-1');
    const productId = catalogIdSchema.parse('product-1');

    expect(
      validateCatalogInput(gameInputSchema, {
        id: gameId,
        canonicalTitle: '  Hades  ',
      }),
    ).toEqual({ id: gameId, canonicalTitle: 'Hades' });
    expect(releaseInputSchema.parse({ id: releaseId, gameId, title: 'Original' })).toMatchObject({
      gameId,
      title: 'Original',
    });
    expect(editionInputSchema.parse({ id: editionId, releaseId, name: 'Standard' })).toMatchObject({
      releaseId,
      name: 'Standard',
    });

    const product = productInputSchema.parse({
      id: productId,
      editionId,
      platform: { family: 'pc', variant: 'steam-compatible' },
      distribution: 'digital_storefront',
    });
    expect(product).toMatchObject({
      id: productId,
      editionId,
      platform: { family: 'pc', variant: 'steam-compatible' },
      distribution: 'digital_storefront',
    });
    expect(() =>
      productInputSchema.parse({ ...product, distributionIdentifier: 'steam-app-1145360' }),
    ).toThrow();
    expect(() => catalogIdSchema.parse(' ')).toThrow();
    expect(() => productInputSchema.parse({ ...product, id: '' })).toThrow();
  });

  it('rejects descriptions and safely rejects a whitespace-only canonical title', () => {
    expect(() =>
      gameInputSchema.parse({ id: 'game-1', canonicalTitle: 'Hades', description: 'x' }),
    ).toThrow();
    expect(() =>
      releaseInputSchema.parse({
        id: 'release-1',
        gameId: 'game-1',
        title: 'Original',
        description: 'x',
      }),
    ).toThrow();
    expect(() =>
      editionInputSchema.parse({
        id: 'edition-1',
        releaseId: 'release-1',
        name: 'Standard',
        description: 'x',
      }),
    ).toThrow();

    const submittedValue = '   ';
    let error: unknown;
    try {
      validateCatalogInput(gameInputSchema, {
        id: 'game-1',
        canonicalTitle: submittedValue,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'INPUT_INVALID', message: 'Input is invalid' });
    expect(JSON.stringify(error)).not.toContain(submittedValue);
    expect(String(error)).not.toContain(submittedValue);
  });

  it('rejects invalid platform and distribution context', () => {
    const valid = {
      id: 'product-1',
      editionId: 'edition-1',
      platform: { family: 'playstation', variant: 'PS5' },
      distribution: 'physical_used',
    };
    expect(productInputSchema.parse(valid)).toMatchObject(valid);
    expect(() => productInputSchema.parse({ ...valid, platform: { family: 'mobile' } })).toThrow();
    expect(() => productInputSchema.parse({ ...valid, distribution: 'streaming' })).toThrow();
  });

  it('validates compositions and rejects self-reference, invalid quantity, and duplicate pairs', () => {
    const composition = {
      parentProductId: 'bundle-1',
      componentProductId: 'game-1-product',
      quantity: 2,
      componentType: 'base_game',
      requiredForCompleteness: true,
    };
    expect(productCompositionInputSchema.parse(composition)).toEqual(composition);
    expect(() => productCompositionInputSchema.parse({ ...composition, quantity: 0 })).toThrow();
    expect(() =>
      productCompositionInputSchema.parse({
        ...composition,
        parentProductId: composition.componentProductId,
      }),
    ).toThrow();
    expect(() =>
      productCompositionInputSchema.parse({
        ...composition,
        componentType: 'season_pass',
      }),
    ).toThrow();
    expect(() => productCompositionsInputSchema.parse([composition, composition])).toThrow();
  });

  it('validates mapping states without conflating external and canonical identity', () => {
    const unmatched = {
      providerId: 'store-a',
      providerProductId: 'sku-123',
      state: 'unmatched',
    };
    expect(providerProductMappingInputSchema.parse(unmatched)).toEqual(unmatched);
    expect(
      providerProductMappingInputSchema.parse({
        ...unmatched,
        state: 'verified',
        productId: 'canonical-product-1',
      }),
    ).toMatchObject({
      state: 'verified',
      productId: 'canonical-product-1',
    });
    expect(() =>
      providerProductMappingInputSchema.parse({
        ...unmatched,
        state: 'verified',
      }),
    ).toThrow();
    expect(() =>
      providerProductMappingInputSchema.parse({
        ...unmatched,
        state: 'unmatched',
        productId: 'canonical-product-1',
      }),
    ).toThrow();
    expect(() =>
      providerProductMappingInputSchema.parse({ ...unmatched, state: 'ignored' }),
    ).toThrow();
  });
});
