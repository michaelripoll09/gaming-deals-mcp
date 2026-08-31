import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/persistence/sqlite/database.js';
import { createTemporaryDatabasePath } from '../helpers/temp-database.js';

describe('openDatabase', () => {
  test('migrates then safely reopens a database', () => {
    const path = createTemporaryDatabasePath();
    const first = openDatabase(path);
    expect(first.database.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    first.close();

    const second = openDatabase(path);
    expect(second.database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'wishlist_entries')).toEqual({ name: 'wishlist_entries' });
    second.close();
  });

  test('rejects a future schema version', () => {
    const path = createTemporaryDatabasePath();
    const database = new DatabaseSync(path);
    database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    database.exec("INSERT INTO schema_migrations VALUES (999, 'future', '2026-08-30T00:00:00.000Z')");
    database.close();

    expect(() => openDatabase(path)).toThrow('Unsupported future schema version');
  });

  test('rejects an applied migration with a changed checksum', () => {
    const path = createTemporaryDatabasePath();
    const opened = openDatabase(path);
    opened.close();

    const database = new DatabaseSync(path);
    database.exec("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 1");
    database.close();

    expect(() => openDatabase(path)).toThrow('Migration checksum mismatch');
  });
});
