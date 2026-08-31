import type { ProductVariant } from '../domain/catalog/types.js';
import { PublicError } from '../errors/public-error.js';
import type { CatalogRepository } from './ports.js';

export class CatalogService {
  constructor(private readonly catalogRepository: CatalogRepository) {}

  async search(query: string): Promise<ProductVariant[]> {
    try {
      return this.catalogRepository.search(query);
    } catch (error) {
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }
}
