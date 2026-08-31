import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import { applyMigrations } from '../../src/persistence/sqlite/migrations.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

const initialMigration = readFileSync(
  new URL('../../src/persistence/sqlite/migrations/001_initial.sql', import.meta.url),
  'utf8',
);
const initialChecksum = createHash('sha256').update(initialMigration, 'utf8').digest('hex');

function columnNames(database: DatabaseSync, table: string): string[] {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => String(name));
}

function seedVersionOneGraph(database: DatabaseSync): void {
  database.exec(initialMigration);
  database.prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)')
    .run(1, initialChecksum, '2026-08-30T00:00:00.000Z');
  database.exec(`
    INSERT INTO games VALUES ('00000000-0000-4000-8000-000000000001', 'Example Game', 'example game', '2026-08-30T00:00:00.000Z');
    INSERT INTO releases VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Example Game', NULL, '2026-08-30T00:00:00.000Z');
    INSERT INTO editions VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'Standard', '2026-08-30T00:00:00.000Z');
    INSERT INTO product_variants VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'pc', 'digital_storefront', '2026-08-30T00:00:00.000Z');
    INSERT INTO provider_listings VALUES ('00000000-0000-4000-8000-000000000005', 'legacy-provider', 'legacy-product', '00000000-0000-4000-8000-000000000004', 'verified');
    INSERT INTO offers VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000005', 'CO', 'COP', 4999000, 'https://example.test/legacy', 1, '2026-08-30T00:00:00.000Z');
    INSERT INTO price_observations VALUES ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000005', 'legacy-observation', 4999000, 'COP', NULL, NULL, '2026-08-30T00:00:00.000Z');
    INSERT INTO wishlist_entries VALUES ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000004', '2026-08-30T00:00:00.000Z');
  `);
}

describe('contract alignment migration', () => {
  test('migrates a fresh database to version two with every Task 3 field', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const opened = openDatabase(temporaryDatabase.path);

    try {
      expect(opened.database.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
        .toEqual([{ version: 1 }, { version: 2 }]);
      expect(columnNames(opened.database, 'product_variants')).toEqual(expect.arrayContaining(['region_code']));
      expect(columnNames(opened.database, 'offers')).toEqual(expect.arrayContaining([
        'source_observation_key', 'normalized_amount_minor', 'normalized_currency',
        'normalized_final_amount_minor', 'normalized_final_currency', 'exchange_rate_source',
        'converted_at', 'region_status', 'retailer_class', 'source_confidence', 'shipping_known',
        'taxes_known',
      ]));
      expect(columnNames(opened.database, 'wishlist_entries')).toEqual(expect.arrayContaining([
        'priority', 'target_amount_minor', 'target_currency', 'notes', 'updated_at',
      ]));
    } finally {
      opened.close();
      temporaryDatabase.cleanup();
    }
  });

  test('upgrades a version-one row graph without losing relationships and backfills conservative values', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const database = new DatabaseSync(temporaryDatabase.path);

    try {
      seedVersionOneGraph(database);
      applyMigrations(database);

      expect(database.prepare(`
        SELECT product_variants.region_code, offers.region_status, offers.shipping_known,
          offers.taxes_known, wishlist_entries.priority, wishlist_entries.updated_at,
          wishlist_entries.created_at, offers.retailer_class, offers.source_confidence,
          price_observations.offer_id
        FROM offers
        JOIN provider_listings ON provider_listings.id = offers.provider_listing_id
        JOIN product_variants ON product_variants.id = provider_listings.product_variant_id
        JOIN wishlist_entries ON wishlist_entries.product_variant_id = product_variants.id
        JOIN price_observations ON price_observations.offer_id = offers.id
      `).get()).toEqual({
        region_code: 'ZZ', region_status: 'unknown', shipping_known: 0, taxes_known: 0,
        priority: 2, updated_at: '2026-08-30T00:00:00.000Z', created_at: '2026-08-30T00:00:00.000Z',
        retailer_class: null, source_confidence: null, offer_id: '00000000-0000-4000-8000-000000000006',
      });
    } finally {
      database.close();
      temporaryDatabase.cleanup();
    }
  });

  test('round-trips every added Task 3 field', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const opened = openDatabase(temporaryDatabase.path);

    try {
      opened.database.exec(`
        INSERT INTO games VALUES ('10000000-0000-4000-8000-000000000001', 'Round Trip', 'round trip', '2026-08-30T00:00:00.000Z');
        INSERT INTO releases VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Round Trip', NULL, '2026-08-30T00:00:00.000Z');
        INSERT INTO editions VALUES ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Standard', '2026-08-30T00:00:00.000Z');
        INSERT INTO product_variants (id, edition_id, platform, distribution_channel, created_at, region_code)
          VALUES ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'pc', 'digital_storefront', '2026-08-30T00:00:00.000Z', 'CO');
        INSERT INTO provider_listings VALUES ('10000000-0000-4000-8000-000000000005', 'provider', 'product', '10000000-0000-4000-8000-000000000004', 'verified');
        INSERT INTO offers (
          id, provider_listing_id, country, original_currency, original_amount_minor, product_url, available, observed_at,
          source_observation_key, normalized_amount_minor, normalized_currency, normalized_final_amount_minor,
          normalized_final_currency, exchange_rate_source, converted_at, region_status, retailer_class,
          source_confidence, shipping_known, taxes_known
        ) VALUES (
          '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000005', 'CO', 'COP', 4999000,
          'https://example.test/round-trip', 1, '2026-08-30T00:00:00.000Z', 'provider:observation:1', 1300, 'USD',
          1100, 'USD', 'ecb', '2026-08-30T00:01:00.000Z', 'compatible', 'authorized_store', 'high', 1, 0
        );
        INSERT INTO wishlist_entries (
          id, product_variant_id, created_at, priority, target_amount_minor, target_currency, notes, updated_at
        ) VALUES (
          '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000004',
          '2026-08-30T00:00:00.000Z', 1, 999, 'USD', NULL, '2026-08-30T00:02:00.000Z'
        );
      `);

      expect(opened.database.prepare(`
        SELECT product_variants.region_code, offers.source_observation_key, offers.normalized_amount_minor,
          offers.normalized_currency, offers.normalized_final_amount_minor, offers.normalized_final_currency,
          offers.exchange_rate_source, offers.converted_at, offers.region_status, offers.retailer_class,
          offers.source_confidence, offers.shipping_known, offers.taxes_known, wishlist_entries.priority,
          wishlist_entries.target_amount_minor, wishlist_entries.target_currency, wishlist_entries.notes,
          wishlist_entries.updated_at
        FROM offers
        JOIN provider_listings ON provider_listings.id = offers.provider_listing_id
        JOIN product_variants ON product_variants.id = provider_listings.product_variant_id
        JOIN wishlist_entries ON wishlist_entries.product_variant_id = product_variants.id
      `).get()).toEqual({
        region_code: 'CO', source_observation_key: 'provider:observation:1', normalized_amount_minor: 1300,
        normalized_currency: 'USD', normalized_final_amount_minor: 1100, normalized_final_currency: 'USD',
        exchange_rate_source: 'ecb', converted_at: '2026-08-30T00:01:00.000Z', region_status: 'compatible',
        retailer_class: 'authorized_store', source_confidence: 'high', shipping_known: 1, taxes_known: 0,
        priority: 1, target_amount_minor: 999, target_currency: 'USD', notes: null,
        updated_at: '2026-08-30T00:02:00.000Z',
      });
    } finally {
      opened.close();
      temporaryDatabase.cleanup();
    }
  });

  test('enforces enum, money-pair, and boolean constraints', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const opened = openDatabase(temporaryDatabase.path);

    try {
      expect(() => opened.database.exec(`
        INSERT INTO games VALUES ('20000000-0000-4000-8000-000000000001', 'Constraints', 'constraints', '2026-08-30T00:00:00.000Z');
        INSERT INTO releases VALUES ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Constraints', NULL, '2026-08-30T00:00:00.000Z');
        INSERT INTO editions VALUES ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Standard', '2026-08-30T00:00:00.000Z');
        INSERT INTO product_variants VALUES ('20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003', 'pc', 'digital_storefront', '2026-08-30T00:00:00.000Z', 'CO');
        INSERT INTO provider_listings VALUES ('20000000-0000-4000-8000-000000000005', 'provider', 'constraints', '20000000-0000-4000-8000-000000000004', 'verified');
        INSERT INTO offers (id, provider_listing_id, country, original_currency, original_amount_minor, product_url, available, observed_at, region_status, shipping_known, taxes_known)
          VALUES ('20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005', 'CO', 'COP', 1, 'https://example.test/constraints', 1, '2026-08-30T00:00:00.000Z', 'invalid', 0, 0);
      `)).toThrow(/CHECK constraint failed/);
      expect(() => opened.database.exec(`
        INSERT INTO offers (id, provider_listing_id, country, original_currency, original_amount_minor, product_url, available, observed_at, normalized_amount_minor, shipping_known, taxes_known)
          VALUES ('20000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000005', 'CO', 'COP', 1, 'https://example.test/pair', 1, '2026-08-30T00:00:00.000Z', 100, 0, 0);
      `)).toThrow(/CHECK constraint failed/);
      expect(() => opened.database.exec(`
        INSERT INTO offers (id, provider_listing_id, country, original_currency, original_amount_minor, product_url, available, observed_at, shipping_known, taxes_known)
          VALUES ('20000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000005', 'CO', 'COP', 1, 'https://example.test/boolean', 1, '2026-08-30T00:00:00.000Z', 2, 0);
      `)).toThrow(/CHECK constraint failed/);
    } finally {
      opened.close();
      temporaryDatabase.cleanup();
    }
  });
});
