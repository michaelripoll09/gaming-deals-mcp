import { randomUUID } from 'node:crypto';
import { wishlistEntrySchema, type WishlistEntry } from '../domain/wishlist/types.js';
import { PublicError } from '../errors/public-error.js';
import type { WishlistRepository } from './ports.js';

export type CreateWishlistEntryInput = Omit<WishlistEntry, 'id' | 'createdAt' | 'updatedAt'> & { now: string };

export class WishlistService {
  constructor(private readonly wishlistRepository: WishlistRepository) {}

  async create(input: CreateWishlistEntryInput): Promise<WishlistEntry> {
    const entry = wishlistEntrySchema.parse({
      id: randomUUID(),
      productVariantId: input.productVariantId,
      priority: input.priority,
      targetPrice: input.targetPrice,
      notes: input.notes,
      createdAt: input.now,
      updatedAt: input.now,
    });

    return this.withPersistence(() => this.wishlistRepository.create(entry));
  }

  async list(): Promise<WishlistEntry[]> {
    return this.withPersistence(() => this.wishlistRepository.list());
  }

  async update(entry: WishlistEntry): Promise<WishlistEntry | null> {
    const parsed = wishlistEntrySchema.parse(entry);
    return this.withPersistence(() => this.wishlistRepository.update(parsed));
  }

  async remove(wishlistEntryId: string): Promise<boolean> {
    return this.withPersistence(() => this.wishlistRepository.remove(wishlistEntryId));
  }

  private withPersistence<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
    }
  }
}
