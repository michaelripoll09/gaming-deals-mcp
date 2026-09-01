import { describe, expect, test } from 'vitest';
import { createApplication } from '../../src/composition/root.js';
import { createDeterministicSyncFixture } from '../../src/providers/deterministic/fixtures.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

const now = '2026-09-01T10:00:00.000Z';
const later = '2026-09-02T10:00:00.000Z';
const unknownId = '00000000-0000-4000-8000-000000000099';

function createInput(productVariantId: string, state: 'owned' | 'subscription_access' | 'loan' = 'owned') {
  return {
    productVariantId,
    state,
    provenance: 'manual' as const,
    activeFrom: null,
    activeUntil: null,
    now,
  };
}

describe('access service', () => {
  test('persists generated identifiers, audit timestamps, all states, and nullable access windows after reopening', async () => {
    const temporary = createTemporaryDatabase();
    const fixture = createDeterministicSyncFixture();
    const first = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      await first.syncDeterministicProvider(now);
      const productVariantId = fixture.catalog[0]!.productVariant.id;
      const created = await Promise.all([
        first.createAccessRecord(createInput(productVariantId, 'owned')),
        first.createAccessRecord({
          ...createInput(productVariantId, 'subscription_access'),
          activeFrom: '2026-09-01T10:00:00.000Z',
          activeUntil: '2026-09-30T10:00:00.000Z',
        }),
        first.createAccessRecord(createInput(productVariantId, 'loan')),
      ]);

      for (const record of created) {
        expect(record).toMatchObject({ productVariantId, provenance: 'manual', createdAt: now, updatedAt: now });
        expect(record.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      }
      const expected = expect.arrayContaining(created);
      expect(await first.listAccessRecords({ productVariantId })).toEqual(expected);
      first.close();

      const second = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });
      try {
        expect(await second.listAccessRecords()).toEqual(expected);
      } finally {
        second.close();
      }
    } finally {
      try { first.close(); } catch { /* already closed */ }
      temporary.cleanup();
    }
  });

  test('rejects an absent canonical product with product_not_found', async () => {
    const temporary = createTemporaryDatabase();
    const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      await expect(application.createAccessRecord(createInput(unknownId)))
        .rejects.toMatchObject({ code: 'product_not_found', message: 'Product variant was not found' });
    } finally {
      application.close();
      temporary.cleanup();
    }
  });

  test('validates update product identities and updates/removes access without changing wishlist intent', async () => {
    const temporary = createTemporaryDatabase();
    const fixture = createDeterministicSyncFixture();
    const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      await application.syncDeterministicProvider(now);
      const productVariantId = fixture.catalog[0]!.productVariant.id;
      const record = await application.createAccessRecord(createInput(productVariantId));
      const updated = await application.updateAccessRecord({ ...record, state: 'loan', updatedAt: later });

      expect(updated).toEqual({ ...record, state: 'loan', updatedAt: later });
      await expect(application.updateAccessRecord({ ...record, productVariantId: unknownId, updatedAt: later }))
        .rejects.toMatchObject({ code: 'product_not_found', message: 'Product variant was not found' });
      expect(await application.updateAccessRecord({ ...record, id: unknownId, updatedAt: later })).toBeNull();
      expect(await application.removeAccessRecord(unknownId)).toBe(false);
      expect(await application.removeAccessRecord(record.id)).toBe(true);
      expect(await application.listWishlistEntries()).toEqual([]);
    } finally {
      application.close();
      temporary.cleanup();
    }
  });

  test('maps access storage failures to persistence_failure', async () => {
    const temporary = createTemporaryDatabase();
    const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    application.close();
    try {
      await expect(application.listAccessRecords())
        .rejects.toMatchObject({ code: 'persistence_failure', message: 'Persistent storage is unavailable' });
    } finally {
      temporary.cleanup();
    }
  });
});
