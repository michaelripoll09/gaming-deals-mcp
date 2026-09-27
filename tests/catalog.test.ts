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
import { openDatabase } from '../src/persistence/sqlite.js';
import { CatalogRepository } from '../src/catalog-repository.js';
import { createCoreServices } from '../src/core-services.js';

const internalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('canonical catalog persistence', () => {
  it('exposes CatalogRepository through CoreServices', async () => {
    const services = createCoreServices({ database: openDatabase(':memory:') });
    expect(services.catalog).toBeInstanceOf(CatalogRepository);
    const gameId = services.catalog.createGame({ canonicalTitle: 'Hades' });
    expect(services.catalog.getGame(gameId)).toEqual({ id: gameId, canonicalTitle: 'Hades' });
    await services.close();
  });

  it('persists hierarchy with generated opaque IDs and survives a file-backed restart', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = mkdtempSync(join(tmpdir(), 'catalog-'));
    const path = join(directory, 'catalog.sqlite');
    try {
      const db = openDatabase(path);
      const catalog = new CatalogRepository(db);
      const gameId = catalog.createGame({ canonicalTitle: 'Hades' });
      const releaseId = catalog.createRelease({ gameId, title: 'Original' });
      const editionId = catalog.createEdition({ releaseId, name: 'Standard' });
      const productId = catalog.createProduct({
        editionId,
        platform: { family: 'pc', variant: 'Steam Deck' },
        distribution: 'digital_storefront',
      });
      for (const id of [gameId, releaseId, editionId, productId]) {
        expect(id).toMatch(internalUuidPattern);
      }
      expect(new Set([gameId, releaseId, editionId, productId]).size).toBe(4);
      db.close();

      const reopened = openDatabase(path);
      expect(new CatalogRepository(reopened).getProduct(productId)).toEqual({
        id: productId,
        editionId,
        platform: { family: 'pc', variant: 'Steam Deck' },
        distribution: 'digital_storefront',
      });
      reopened.close();
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reconstructs the catalog graph and preserves composition and canonical mapping after restart', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = mkdtempSync(join(tmpdir(), 'catalog-services-'));
    const path = join(directory, 'catalog.sqlite');
    try {
      const first = createCoreServices({ env: { DATABASE_PATH: path } });
      const gameId = first.catalog.createGame({ canonicalTitle: 'Hades II' });
      const releaseId = first.catalog.createRelease({ gameId, title: 'Early Access' });
      const editionId = first.catalog.createEdition({ releaseId, name: 'Deluxe' });
      const pcProductId = first.catalog.createProduct({
        editionId,
        platform: { family: 'pc', variant: 'steam-compatible' },
        distribution: 'digital_storefront',
      });
      const ps5ProductId = first.catalog.createProduct({
        editionId,
        platform: { family: 'playstation', variant: 'PS5' },
        distribution: 'physical_new',
      });
      const composition = {
        parentProductId: ps5ProductId,
        componentProductId: pcProductId,
        quantity: 1,
        componentType: 'base_game' as const,
        requiredForCompleteness: true,
      };
      first.catalog.addComposition(composition);
      const identity = { providerId: 'store', providerProductId: 'ps5-edition' };
      const mapping = first.catalog.upsertMapping({
        ...identity,
        state: 'verified',
        productId: ps5ProductId,
      });
      await first.close();

      const restarted = createCoreServices({ env: { DATABASE_PATH: path } });
      const catalog = restarted.catalog;
      expect(catalog.getGame(gameId)).toEqual({ id: gameId, canonicalTitle: 'Hades II' });
      const releases = catalog.listReleasesByGame(gameId);
      expect(releases).toEqual([{ id: releaseId, gameId, title: 'Early Access' }]);
      const editions = catalog.listEditionsByRelease(releases[0]!.id);
      expect(editions).toEqual([{ id: editionId, releaseId, name: 'Deluxe' }]);
      const products = catalog.listProductsByEdition(editions[0]!.id);
      expect(products).toHaveLength(2);
      expect(products).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: pcProductId,
            platform: { family: 'pc', variant: 'steam-compatible' },
          }),
          expect.objectContaining({
            id: ps5ProductId,
            platform: { family: 'playstation', variant: 'PS5' },
          }),
        ]),
      );
      expect(catalog.listComponentsForParent(ps5ProductId)).toEqual([composition]);
      const restoredMapping = catalog.getMapping(identity);
      expect(restoredMapping).toEqual(mapping);
      expect(restoredMapping.productId).toBe(ps5ProductId);
      await restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('lists catalog records by their parent with independent product context filters', () => {
    const db = openDatabase(':memory:');
    const catalog = new CatalogRepository(db);
    const gameId = catalog.createGame({ canonicalTitle: 'Hades' });
    const otherGameId = catalog.createGame({ canonicalTitle: 'Celeste' });
    const releaseId = catalog.createRelease({ gameId, title: 'Original' });
    const secondReleaseId = catalog.createRelease({ gameId, title: 'Anniversary' });
    const unrelatedReleaseId = catalog.createRelease({ gameId: otherGameId, title: 'Original' });
    const editionId = catalog.createEdition({ releaseId, name: 'Standard' });
    const secondEditionId = catalog.createEdition({ releaseId, name: 'Deluxe' });
    const unrelatedEditionId = catalog.createEdition({
      releaseId: unrelatedReleaseId,
      name: 'Standard',
    });
    const parentProductId = catalog.createProduct({
      editionId,
      platform: { family: 'pc', variant: 'steam-compatible' },
      distribution: 'digital_storefront',
    });
    const componentProductId = catalog.createProduct({
      editionId,
      platform: { family: 'pc' },
      distribution: 'digital_key',
    });
    const otherPlatformProductId = catalog.createProduct({
      editionId,
      platform: { family: 'xbox', variant: 'Series X' },
      distribution: 'digital_storefront',
    });
    catalog.createProduct({
      editionId: secondEditionId,
      platform: { family: 'pc', variant: 'steam-compatible' },
      distribution: 'digital_storefront',
    });

    expect(catalog.listReleasesByGame(gameId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: releaseId, gameId, title: 'Original' }),
        expect.objectContaining({ id: secondReleaseId, gameId, title: 'Anniversary' }),
      ]),
    );
    expect(catalog.listReleasesByGame(gameId)).toHaveLength(2);
    expect(catalog.listEditionsByRelease(releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: editionId, releaseId, name: 'Standard' }),
        expect.objectContaining({ id: secondEditionId, releaseId, name: 'Deluxe' }),
      ]),
    );
    expect(catalog.listEditionsByRelease(releaseId)).toHaveLength(2);
    expect(catalog.listProductsByEdition(editionId)).toHaveLength(3);
    expect(
      catalog.listProductsByEdition(editionId, {
        platformFamily: 'pc',
        platformVariant: 'steam-compatible',
        distribution: 'digital_storefront',
      }),
    ).toEqual([
      expect.objectContaining({
        id: parentProductId,
        platform: { family: 'pc', variant: 'steam-compatible' },
        distribution: 'digital_storefront',
      }),
    ]);
    expect(catalog.listProductsByEdition(editionId, { distribution: 'digital_key' })).toEqual([
      expect.objectContaining({
        id: componentProductId,
        platform: { family: 'pc' },
        distribution: 'digital_key',
      }),
    ]);
    expect(catalog.listProductsByEdition(editionId, { platformFamily: 'xbox' })).toEqual([
      expect.objectContaining({
        id: otherPlatformProductId,
        platform: { family: 'xbox', variant: 'Series X' },
      }),
    ]);

    const composition = {
      parentProductId,
      componentProductId,
      quantity: 1,
      componentType: 'base_game' as const,
      requiredForCompleteness: true,
    };
    catalog.addComposition(composition);
    expect(catalog.listComponentsForParent(parentProductId)).toEqual([composition]);
    expect(catalog.listEditionsByRelease(secondReleaseId)).toEqual([]);
    expect(catalog.listProductsByEdition(unrelatedEditionId)).toEqual([]);
    db.close();
  });

  it('enforces hierarchy foreign keys, restricts deletes, and rejects invalid input', () => {
    const db = openDatabase(':memory:');
    const catalog = new CatalogRepository(db);
    expect(() =>
      catalog.createRelease({ gameId: catalogIdSchema.parse('missing'), title: 'No parent' }),
    ).toThrow(AppError);
    const gameId = catalog.createGame({ canonicalTitle: 'Hades' });
    const releaseId = catalog.createRelease({ gameId, title: 'Original' });
    const editionId = catalog.createEdition({ releaseId, name: 'Standard' });
    const productId = catalog.createProduct({
      editionId,
      platform: { family: 'pc' },
      distribution: 'digital_storefront',
    });
    expect(() =>
      catalog.createEdition({ releaseId: catalogIdSchema.parse('missing'), name: 'Orphan' }),
    ).toThrow(AppError);
    expect(() =>
      catalog.createProduct({
        editionId: catalogIdSchema.parse('missing'),
        platform: { family: 'pc' },
        distribution: 'digital_storefront',
      }),
    ).toThrow(AppError);
    expect(() => catalog.deleteGame(gameId)).toThrow(AppError);
    expect(() => catalog.deleteRelease(releaseId)).toThrow(AppError);
    expect(() => catalog.deleteEdition(editionId)).toThrow(AppError);
    expect(() => catalog.deleteProduct(productId)).not.toThrow();
    expect(() => catalog.createGame({ canonicalTitle: '   ' })).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID' }),
    );
    db.close();
  });

  it('makes composition creation idempotent and rejects conflicting duplicates', () => {
    const db = openDatabase(':memory:');
    const catalog = new CatalogRepository(db);
    const gameId = catalog.createGame({ canonicalTitle: 'Bundle' });
    const releaseId = catalog.createRelease({ gameId, title: 'Base' });
    const editionId = catalog.createEdition({ releaseId, name: 'Standard' });
    const parentProductId = catalog.createProduct({
      editionId,
      platform: { family: 'pc' },
      distribution: 'digital_storefront',
    });
    const componentProductId = catalog.createProduct({
      editionId,
      platform: { family: 'pc' },
      distribution: 'digital_key',
    });
    const composition = {
      parentProductId,
      componentProductId,
      quantity: 1,
      componentType: 'base_game' as const,
      requiredForCompleteness: true,
    };
    expect(catalog.addComposition(composition)).toBe('created');
    expect(catalog.addComposition(composition)).toBe('existing');
    expect(() => catalog.addComposition({ ...composition, quantity: 2 })).toThrow(AppError);
    expect(() => catalog.deleteProduct(parentProductId)).toThrow(AppError);
    expect(() => catalog.deleteProduct(componentProductId)).toThrow(AppError);
    expect(() =>
      catalog.addComposition({
        ...composition,
        componentProductId: catalogIdSchema.parse('missing'),
      }),
    ).toThrow(AppError);
    expect(() =>
      catalog.addComposition({
        ...composition,
        parentProductId: catalogIdSchema.parse('missing'),
      }),
    ).toThrow(AppError);
    db.close();
  });

  it('roundtrips mapping states and forbids implicit ambiguous promotion', () => {
    const db = openDatabase(':memory:');
    const catalog = new CatalogRepository(db);
    const gameId = catalog.createGame({ canonicalTitle: 'Game' });
    const releaseId = catalog.createRelease({ gameId, title: 'Release' });
    const editionId = catalog.createEdition({ releaseId, name: 'Edition' });
    const productId = catalog.createProduct({
      editionId,
      platform: { family: 'xbox', variant: 'Series X' },
      distribution: 'digital_storefront',
    });
    const identity = { providerId: 'store', providerProductId: 'external-42' };
    const unmatched = catalog.upsertMapping({ ...identity, state: 'unmatched' });
    expect(unmatched).toMatchObject({ ...identity, state: 'unmatched' });
    expect(unmatched.id).toMatch(internalUuidPattern);
    for (const state of ['probable', 'verified', 'ambiguous'] as const) {
      const mapping = catalog.upsertMapping({ ...identity, state, productId });
      expect(mapping.id).toMatch(internalUuidPattern);
      expect(mapping).toMatchObject({ ...identity, state, productId });
      expect(catalog.getMapping(identity)).toEqual(mapping);
    }
    expect(() => catalog.upsertMapping({ ...identity, state: 'verified', productId })).toThrow(
      AppError,
    );
    expect(() =>
      catalog.upsertMapping({
        providerId: 'store',
        providerProductId: 'absent',
        state: 'verified',
        productId: catalogIdSchema.parse('missing'),
      }),
    ).toThrow(AppError);
    expect(() => catalog.deleteProduct(productId)).toThrow(AppError);
    db.close();
  });

  it('clears an ambiguous mapping to unmatched without changing its identity', () => {
    const db = openDatabase(':memory:');
    const catalog = new CatalogRepository(db);
    const gameId = catalog.createGame({ canonicalTitle: 'Game' });
    const releaseId = catalog.createRelease({ gameId, title: 'Release' });
    const editionId = catalog.createEdition({ releaseId, name: 'Edition' });
    const productId = catalog.createProduct({
      editionId,
      platform: { family: 'pc' },
      distribution: 'digital_storefront',
    });
    const identity = { providerId: 'store', providerProductId: 'external-ambiguous' };
    const ambiguous = catalog.upsertMapping({ ...identity, state: 'ambiguous', productId });

    expect(() => catalog.upsertMapping({ ...identity, state: 'probable', productId })).toThrow(
      AppError,
    );
    expect(() => catalog.upsertMapping({ ...identity, state: 'verified', productId })).toThrow(
      AppError,
    );
    const unmatched = catalog.upsertMapping({ ...identity, state: 'unmatched' });

    expect(unmatched).toEqual({ ...identity, state: 'unmatched', id: ambiguous.id });
    expect(unmatched.id).toBe(ambiguous.id);
    expect(unmatched.productId).toBeUndefined();
    expect(catalog.getMapping(identity)).toEqual(unmatched);
    db.close();
  });

  it('does not leak SQLite details from persistence errors', () => {
    const db = openDatabase(':memory:');
    const catalog = new CatalogRepository(db);
    const id = catalogIdSchema.parse('secret-sql-value');
    db.close();
    expect(() => catalog.getGame(id)).toThrow(
      expect.objectContaining({ code: 'PERSISTENCE_UNAVAILABLE' }),
    );
  });
});

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
    expect(() => productCompositionInputSchema.parse({ ...composition, quantity: -1 })).toThrow();
    expect(() => productCompositionInputSchema.parse({ ...composition, quantity: 1.5 })).toThrow();
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
    expect(
      productCompositionsInputSchema.parse([
        {
          ...composition,
          parentProductId: 'a\u0000b',
          componentProductId: 'c',
        },
        {
          ...composition,
          parentProductId: 'a',
          componentProductId: 'b\u0000c',
        },
      ]),
    ).toHaveLength(2);
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
    expect(() =>
      providerProductMappingInputSchema.parse({ ...unmatched, providerId: '   ' }),
    ).toThrow();
    expect(() =>
      providerProductMappingInputSchema.parse({ ...unmatched, providerProductId: '   ' }),
    ).toThrow();
    for (const state of ['verified', 'probable', 'ambiguous'] as const) {
      expect(() => providerProductMappingInputSchema.parse({ ...unmatched, state })).toThrow();
    }
  });
});
