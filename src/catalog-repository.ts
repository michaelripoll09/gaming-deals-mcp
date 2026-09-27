import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  catalogIdSchema,
  editionInputSchema,
  gameInputSchema,
  productCompositionInputSchema,
  productInputSchema,
  providerProductMappingInputSchema,
  releaseInputSchema,
  validateCatalogInput,
  type CatalogId,
  type EditionInput,
  type GameInput,
  type ProductCompositionInput,
  type ProductDistribution,
  type ProductInput,
  type PlatformFamily,
  type ProviderProductMappingInput,
  type ReleaseInput,
} from './catalog.js';
import { AppError } from './errors.js';

export type NewGame = Omit<GameInput, 'id'>;
export type NewRelease = Omit<ReleaseInput, 'id'>;
export type NewEdition = Omit<EditionInput, 'id'>;
export type NewProduct = Omit<ProductInput, 'id'>;
export type ProviderProductIdentity = Pick<
  ProviderProductMappingInput,
  'providerId' | 'providerProductId'
>;
export type ProviderProductMapping = ProviderProductMappingInput & {
  readonly id: CatalogId;
};
export interface ProductListFilters {
  platformFamily?: PlatformFamily;
  platformVariant?: string | null;
  distribution?: ProductDistribution;
}

interface GameRow {
  id: string;
  canonical_title: string;
}
interface ReleaseRow {
  id: string;
  game_id: string;
  title: string;
}
interface EditionRow {
  id: string;
  release_id: string;
  name: string;
}
interface ProductRow {
  id: string;
  edition_id: string;
  platform_family: string;
  platform_variant: string | null;
  distribution: string;
}
interface ProductCompositionRow {
  parent_product_id: string;
  component_product_id: string;
  quantity: number;
  component_type: string;
  required_for_completeness: number;
}
interface MappingRow {
  id: string;
  provider_id: string;
  provider_product_id: string;
  product_id: string | null;
  state: string;
}

/** Small persistence boundary for canonical catalog identities and relationships. */
export class CatalogRepository {
  public constructor(private readonly db: Database.Database) {}

  public createGame(input: NewGame): CatalogId {
    const id = newId();
    const game = validateCatalogInput(gameInputSchema, { ...input, id });
    return this.persist(() => {
      this.db
        .prepare('INSERT INTO games (id, canonical_title) VALUES (?, ?)')
        .run(game.id, game.canonicalTitle);
      return game.id;
    });
  }

  public getGame(id: CatalogId): GameInput {
    return this.read(() => {
      const row = this.db.prepare('SELECT id, canonical_title FROM games WHERE id = ?').get(id) as
        GameRow | undefined;
      if (!row) throw persistenceError();
      return validateCatalogInput(gameInputSchema, {
        id: row.id,
        canonicalTitle: row.canonical_title,
      });
    });
  }

  public deleteGame(id: CatalogId): void {
    this.delete('DELETE FROM games WHERE id = ?', id);
  }

  public createRelease(input: NewRelease): CatalogId {
    const id = newId();
    const release = validateCatalogInput(releaseInputSchema, { ...input, id });
    return this.persist(() => {
      this.db
        .prepare('INSERT INTO releases (id, game_id, title) VALUES (?, ?, ?)')
        .run(release.id, release.gameId, release.title);
      return release.id;
    });
  }

  public getRelease(id: CatalogId): ReleaseInput {
    return this.read(() => {
      const row = this.db
        .prepare('SELECT id, game_id, title FROM releases WHERE id = ?')
        .get(id) as ReleaseRow | undefined;
      if (!row) throw persistenceError();
      return validateCatalogInput(releaseInputSchema, {
        id: row.id,
        gameId: row.game_id,
        title: row.title,
      });
    });
  }

  public listReleasesByGame(gameId: CatalogId): ReleaseInput[] {
    return this.read(() => {
      const rows = this.db
        .prepare('SELECT id, game_id, title FROM releases WHERE game_id = ? ORDER BY id')
        .all(gameId) as ReleaseRow[];
      return rows.map((row) =>
        validateCatalogInput(releaseInputSchema, {
          id: row.id,
          gameId: row.game_id,
          title: row.title,
        }),
      );
    });
  }

  public deleteRelease(id: CatalogId): void {
    this.delete('DELETE FROM releases WHERE id = ?', id);
  }

  public createEdition(input: NewEdition): CatalogId {
    const id = newId();
    const edition = validateCatalogInput(editionInputSchema, { ...input, id });
    return this.persist(() => {
      this.db
        .prepare('INSERT INTO editions (id, release_id, name) VALUES (?, ?, ?)')
        .run(edition.id, edition.releaseId, edition.name);
      return edition.id;
    });
  }

  public getEdition(id: CatalogId): EditionInput {
    return this.read(() => {
      const row = this.db
        .prepare('SELECT id, release_id, name FROM editions WHERE id = ?')
        .get(id) as EditionRow | undefined;
      if (!row) throw persistenceError();
      return validateCatalogInput(editionInputSchema, {
        id: row.id,
        releaseId: row.release_id,
        name: row.name,
      });
    });
  }

  public listEditionsByRelease(releaseId: CatalogId): EditionInput[] {
    return this.read(() => {
      const rows = this.db
        .prepare('SELECT id, release_id, name FROM editions WHERE release_id = ? ORDER BY id')
        .all(releaseId) as EditionRow[];
      return rows.map((row) =>
        validateCatalogInput(editionInputSchema, {
          id: row.id,
          releaseId: row.release_id,
          name: row.name,
        }),
      );
    });
  }

  public deleteEdition(id: CatalogId): void {
    this.delete('DELETE FROM editions WHERE id = ?', id);
  }

  public createProduct(input: NewProduct): CatalogId {
    const id = newId();
    const product = validateCatalogInput(productInputSchema, { ...input, id });
    return this.persist(() => {
      this.db
        .prepare(
          'INSERT INTO products (id, edition_id, platform_family, platform_variant, distribution) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          product.id,
          product.editionId,
          product.platform.family,
          product.platform.variant ?? null,
          product.distribution,
        );
      return product.id;
    });
  }

  public getProduct(id: CatalogId): ProductInput {
    return this.read(() => {
      const row = this.db
        .prepare(
          'SELECT id, edition_id, platform_family, platform_variant, distribution FROM products WHERE id = ?',
        )
        .get(id) as ProductRow | undefined;
      if (!row) throw persistenceError();
      return validateProductRow(row);
    });
  }

  public listProductsByEdition(
    editionId: CatalogId,
    filters: ProductListFilters = {},
  ): ProductInput[] {
    return this.read(() => {
      const conditions = ['edition_id = ?'];
      const parameters: (string | null)[] = [editionId];
      if (filters.platformFamily !== undefined) {
        conditions.push('platform_family = ?');
        parameters.push(filters.platformFamily);
      }
      if (filters.platformVariant !== undefined) {
        conditions.push('platform_variant IS ?');
        parameters.push(filters.platformVariant);
      }
      if (filters.distribution !== undefined) {
        conditions.push('distribution = ?');
        parameters.push(filters.distribution);
      }
      const rows = this.db
        .prepare(
          `SELECT id, edition_id, platform_family, platform_variant, distribution
           FROM products WHERE ${conditions.join(' AND ')} ORDER BY id`,
        )
        .all(...parameters) as ProductRow[];
      return rows.map(validateProductRow);
    });
  }

  public deleteProduct(id: CatalogId): void {
    this.delete('DELETE FROM products WHERE id = ?', id);
  }

  public addComposition(input: ProductCompositionInput): 'created' | 'existing' {
    const composition = validateCatalogInput(productCompositionInputSchema, input);
    return this.persist(() => {
      const existing = this.db
        .prepare(
          'SELECT quantity, component_type, required_for_completeness FROM product_compositions WHERE parent_product_id = ? AND component_product_id = ?',
        )
        .get(composition.parentProductId, composition.componentProductId) as
        { quantity: number; component_type: string; required_for_completeness: number } | undefined;
      if (existing) {
        if (
          existing.quantity === composition.quantity &&
          existing.component_type === composition.componentType &&
          existing.required_for_completeness === Number(composition.requiredForCompleteness)
        ) {
          return 'existing';
        }
        throw new AppError('INPUT_INVALID', 'Catalog input is invalid');
      }
      this.db
        .prepare(
          'INSERT INTO product_compositions (parent_product_id, component_product_id, quantity, component_type, required_for_completeness) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          composition.parentProductId,
          composition.componentProductId,
          composition.quantity,
          composition.componentType,
          Number(composition.requiredForCompleteness),
        );
      return 'created';
    });
  }

  public listComponentsForParent(parentProductId: CatalogId): ProductCompositionInput[] {
    return this.read(() => {
      const rows = this.db
        .prepare(
          `SELECT parent_product_id, component_product_id, quantity, component_type,
           required_for_completeness FROM product_compositions
           WHERE parent_product_id = ? ORDER BY component_product_id`,
        )
        .all(parentProductId) as ProductCompositionRow[];
      return rows.map((row) =>
        validateCatalogInput(productCompositionInputSchema, {
          parentProductId: row.parent_product_id,
          componentProductId: row.component_product_id,
          quantity: row.quantity,
          componentType: row.component_type,
          requiredForCompleteness: row.required_for_completeness === 1,
        }),
      );
    });
  }

  public deleteComposition(parentProductId: CatalogId, componentProductId: CatalogId): void {
    this.delete(
      'DELETE FROM product_compositions WHERE parent_product_id = ? AND component_product_id = ?',
      parentProductId,
      componentProductId,
    );
  }

  public upsertMapping(input: ProviderProductMappingInput): ProviderProductMapping {
    const mapping = validateCatalogInput(providerProductMappingInputSchema, input);
    return this.persist(() => {
      const previous = this.db
        .prepare(
          'SELECT id, state FROM provider_product_mappings WHERE provider_id = ? AND provider_product_id = ?',
        )
        .get(mapping.providerId, mapping.providerProductId) as
        { id: string; state: string } | undefined;
      if (previous?.state === 'ambiguous' && mapping.state !== 'ambiguous') {
        throw new AppError('INPUT_INVALID', 'Catalog input is invalid');
      }
      const id = previous?.id ?? newId();
      this.db
        .prepare(
          `INSERT INTO provider_product_mappings (
          id, provider_id, provider_product_id, product_id, state
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, provider_product_id)
        DO UPDATE SET product_id = excluded.product_id, state = excluded.state`,
        )
        .run(
          id,
          mapping.providerId,
          mapping.providerProductId,
          mapping.state === 'unmatched' ? null : mapping.productId,
          mapping.state,
        );
      return this.getMappingUnsafe({
        providerId: mapping.providerId,
        providerProductId: mapping.providerProductId,
      });
    });
  }

  public getMapping(identity: ProviderProductIdentity): ProviderProductMapping {
    const parsed = validateCatalogInput(providerProductMappingInputSchema, {
      ...identity,
      state: 'unmatched',
    });
    return this.read(() => this.getMappingUnsafe(parsed));
  }

  private getMappingUnsafe(identity: ProviderProductIdentity): ProviderProductMapping {
    const row = this.db
      .prepare(
        'SELECT id, provider_id, provider_product_id, product_id, state FROM provider_product_mappings WHERE provider_id = ? AND provider_product_id = ?',
      )
      .get(identity.providerId, identity.providerProductId) as MappingRow | undefined;
    if (!row) throw persistenceError();
    const record = {
      id: row.id,
      providerId: row.provider_id,
      providerProductId: row.provider_product_id,
      state: row.state,
      ...(row.product_id === null ? {} : { productId: row.product_id }),
    };
    const { id: _id, ...mapping } = record;
    return {
      ...validateCatalogInput(providerProductMappingInputSchema, mapping),
      id: catalogIdSchema.parse(row.id),
    } as ProviderProductMapping;
  }

  private delete(sql: string, ...parameters: string[]): void {
    this.persist(() => {
      const result = this.db.prepare(sql).run(...parameters);
      if (result.changes !== 1) throw persistenceError();
    });
  }

  private read<T>(operation: () => T): T {
    try {
      return operation();
    } catch (cause) {
      throw safePersistenceError(cause);
    }
  }

  private persist<T>(operation: () => T): T {
    try {
      return operation();
    } catch (cause) {
      throw safePersistenceError(cause);
    }
  }
}

function newId(): CatalogId {
  return catalogIdSchema.parse(randomUUID());
}

function validateProductRow(row: ProductRow): ProductInput {
  return validateCatalogInput(productInputSchema, {
    id: row.id,
    editionId: row.edition_id,
    platform: {
      family: row.platform_family,
      ...(row.platform_variant === null ? {} : { variant: row.platform_variant }),
    },
    distribution: row.distribution,
  });
}

function persistenceError(): AppError {
  return new AppError('PERSISTENCE_UNAVAILABLE', 'Catalog persistence failed');
}

function safePersistenceError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  return new AppError('PERSISTENCE_UNAVAILABLE', 'Catalog persistence failed', { cause });
}
