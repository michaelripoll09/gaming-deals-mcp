import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

describe('openDatabase', () => {
  test('migrates then safely reopens a database', () => {
    const temporaryDatabase = createTemporaryDatabase();

    try {
      const first = openDatabase(temporaryDatabase.path);
      try {
        expect(first.database.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
          .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
      } finally {
        first.close();
      }

      const second = openDatabase(temporaryDatabase.path);
      try {
        expect(second.database.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
          .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
      } finally {
        second.close();
      }
    } finally {
      temporaryDatabase.cleanup();
    }
  });

  test('preserves distinct regional variants and one global variant across reopen', () => {
    const temporaryDatabase = createTemporaryDatabase();

    try {
      const first = openDatabase(temporaryDatabase.path);
      try {
        first.database.exec(`
          INSERT INTO games VALUES ('game', 'Example Game', 'example game', '2026-08-31T00:00:00.000Z');
          INSERT INTO releases VALUES ('release', 'game', 'Example Game', NULL, '2026-08-31T00:00:00.000Z');
          INSERT INTO editions VALUES ('edition', 'release', 'Standard', '2026-08-31T00:00:00.000Z');
          INSERT INTO product_variants (id, edition_id, platform, distribution_channel, created_at, region_code)
            VALUES
              ('variant-co', 'edition', 'pc', 'digital_storefront', '2026-08-31T00:00:00.000Z', 'CO'),
              ('variant-us', 'edition', 'pc', 'digital_storefront', '2026-08-31T00:00:00.000Z', 'US'),
              ('variant-global', 'edition', 'pc', 'digital_storefront', '2026-08-31T00:00:00.000Z', NULL);
        `);

        expect(() => first.database.exec(`
          INSERT INTO product_variants (id, edition_id, platform, distribution_channel, created_at, region_code)
          VALUES ('variant-second-global', 'edition', 'pc', 'digital_storefront', '2026-08-31T00:00:00.000Z', NULL);
        `)).toThrow(/UNIQUE constraint failed/);
      } finally {
        first.close();
      }

      const second = openDatabase(temporaryDatabase.path);
      try {
        expect(second.database.prepare(`
          SELECT id, region_code FROM product_variants ORDER BY id
        `).all()).toEqual([
          { id: 'variant-co', region_code: 'CO' },
          { id: 'variant-global', region_code: null },
          { id: 'variant-us', region_code: 'US' },
        ]);
      } finally {
        second.close();
      }
    } finally {
      temporaryDatabase.cleanup();
    }
  });

  test('rejects a future schema version', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const database = new DatabaseSync(temporaryDatabase.path);
    try {
      database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
      database.exec("INSERT INTO schema_migrations VALUES (999, 'future', '2026-08-30T00:00:00.000Z')");
    } finally {
      database.close();
    }

    try {
      expect(() => openDatabase(temporaryDatabase.path)).toThrow('Unsupported future schema version');
    } finally {
      temporaryDatabase.cleanup();
    }
  });

  test('rejects an applied migration with a changed checksum', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const opened = openDatabase(temporaryDatabase.path);
    opened.close();

    const database = new DatabaseSync(temporaryDatabase.path);
    try {
      database.exec("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 4");
    } finally {
      database.close();
    }

    try {
      expect(() => openDatabase(temporaryDatabase.path)).toThrow('Migration checksum mismatch');
    } finally {
      temporaryDatabase.cleanup();
    }
  });

  test('removes the temporary database directory after its database is closed', () => {
    const temporaryDatabase = createTemporaryDatabase();
    const directoryPath = dirname(temporaryDatabase.path);
    const opened = openDatabase(temporaryDatabase.path);
    opened.close();

    temporaryDatabase.cleanup();

    expect(existsSync(directoryPath)).toBe(false);
  });
});
