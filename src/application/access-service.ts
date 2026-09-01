import { randomUUID } from 'node:crypto';
import { accessRecordSchema, type AccessRecord } from '../domain/access/types.js';
import { PublicError } from '../errors/public-error.js';
import type { AccessRepository, CatalogRepository } from './ports.js';

export type CreateAccessRecordInput = Omit<AccessRecord, 'id' | 'createdAt' | 'updatedAt' | 'activeFrom' | 'activeUntil'> & {
  activeFrom?: string | null;
  activeUntil?: string | null;
  now: string;
};

export class AccessService {
  constructor(
    private readonly accessRepository: AccessRepository,
    private readonly catalogRepository: CatalogRepository,
  ) {}

  async create(input: CreateAccessRecordInput): Promise<AccessRecord> {
    const record = accessRecordSchema.parse({
      id: randomUUID(),
      productVariantId: input.productVariantId,
      state: input.state,
      provenance: input.provenance,
      activeFrom: input.activeFrom ?? null,
      activeUntil: input.activeUntil ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    });

    await this.ensureProductVariantExists(record.productVariantId);
    await this.withPersistence(() => this.accessRepository.create(record));
    return structuredClone(record);
  }

  async list(filter?: { productVariantId?: string }): Promise<AccessRecord[]> {
    return this.withPersistence(() => this.accessRepository.list(filter));
  }

  async update(record: AccessRecord): Promise<AccessRecord | null> {
    const parsed = accessRecordSchema.parse(record);
    await this.ensureProductVariantExists(parsed.productVariantId);
    return this.withPersistence(() => this.accessRepository.update(parsed));
  }

  async remove(accessRecordId: string): Promise<boolean> {
    return this.withPersistence(() => this.accessRepository.remove(accessRecordId));
  }

  private async ensureProductVariantExists(productVariantId: string): Promise<void> {
    const productVariant = await this.withPersistence(() => this.catalogRepository.findProductVariant(productVariantId));
    if (productVariant === null) {
      throw new PublicError('product_not_found', 'Product variant was not found');
    }
  }

  private async withPersistence<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }
}
