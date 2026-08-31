import { describe, expect, test } from 'vitest';
import { createApplication } from '../../src/composition/root.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

describe('wishlist service', () => {
  test('persists exact money and nullable values after reopening', async () => {
    const temporary = createTemporaryDatabase();
    const fixture = createDeterministicSyncFixture();
    const first = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      await first.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
      const created = await first.createWishlistEntry({
        productVariantId: fixture.catalog[0]!.productVariant.id,
        priority: 1,
        targetPrice: { amountMinor: 3_500_000, currency: 'COP' },
        notes: null,
        now: '2026-08-30T00:00:00.000Z',
      });
      first.close();

      const second = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });
      try {
        expect(await second.listWishlistEntries()).toEqual([created]);
      } finally {
        second.close();
      }
    } finally {
      try { first.close(); } catch { /* already closed */ }
      temporary.cleanup();
    }
  });

  test('updates and removes an existing entry without upserting unknown IDs', async () => {
    const temporary = createTemporaryDatabase();
    const fixture = createDeterministicSyncFixture();
    const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      await application.syncDeterministicProvider('2026-08-30T00:00:00.000Z');
      const created = await application.createWishlistEntry({
        productVariantId: fixture.catalog[0]!.productVariant.id,
        priority: 2,
        targetPrice: null,
        notes: 'Play with friends',
        now: '2026-08-30T00:00:00.000Z',
      });
      const updated = await application.updateWishlistEntry({
        ...created,
        priority: 1,
        targetPrice: { amountMinor: 3_000_000, currency: 'COP' },
        notes: null,
        updatedAt: '2026-08-31T00:00:00.000Z',
      });

      expect(updated).toEqual({
        ...created,
        priority: 1,
        targetPrice: { amountMinor: 3_000_000, currency: 'COP' },
        notes: null,
        updatedAt: '2026-08-31T00:00:00.000Z',
      });
      expect(await application.updateWishlistEntry({ ...created, id: '00000000-0000-4000-8000-000000000099' }))
        .toBeNull();
      expect(await application.removeWishlistEntry('00000000-0000-4000-8000-000000000099')).toBe(false);
      expect(await application.removeWishlistEntry(created.id)).toBe(true);
      expect(await application.listWishlistEntries()).toEqual([]);
    } finally {
      application.close();
      temporary.cleanup();
    }
  });
});
