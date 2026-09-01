import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

interface Migration {
  readonly checksum: string;
  readonly requiresForeignKeysDisabled: boolean;
  readonly sql: string;
  readonly version: number;
}

interface AppliedMigration {
  readonly checksum: string;
  readonly version: number;
}

const migrations: readonly Migration[] = [
  createMigration(1, new URL('./migrations/001_initial.sql', import.meta.url)),
  createMigration(2, new URL('./migrations/002_contract_alignment.sql', import.meta.url)),
  createMigration(3, new URL('./migrations/003_product_variant_region_identity.sql', import.meta.url), true),
];

export function applyMigrations(database: DatabaseSync): void {
  const appliedMigrations = readAppliedMigrations(database);
  const highestBundledVersion = migrations.at(-1)?.version ?? 0;

  if (appliedMigrations.some(({ version }) => version > highestBundledVersion)) {
    throw new Error('Unsupported future schema version');
  }

  for (const migration of migrations) {
    const applied = appliedMigrations.find(({ version }) => version === migration.version);

    if (applied !== undefined && applied.checksum !== migration.checksum) {
      throw new Error(`Migration checksum mismatch for version ${migration.version}`);
    }

    if (applied === undefined) {
      applyMigration(database, migration);
    }
  }
}

function createMigration(version: number, source: URL, requiresForeignKeysDisabled = false): Migration {
  const sql = readFileSync(source, 'utf8');

  return {
    checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    requiresForeignKeysDisabled,
    sql,
    version,
  };
}

function readAppliedMigrations(database: DatabaseSync): AppliedMigration[] {
  const migrationTableExists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();

  if (migrationTableExists === undefined) {
    return [];
  }

  return database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()
    .map(({ checksum, version }) => ({
      checksum: String(checksum),
      version: Number(version),
    }));
}

function applyMigration(database: DatabaseSync, migration: Migration): void {
  if (migration.requiresForeignKeysDisabled) {
    database.exec('PRAGMA foreign_keys = OFF');
  }
  database.exec('BEGIN IMMEDIATE');

  try {
    database.exec(migration.sql);
    const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length > 0) {
      throw new Error(`Migration ${migration.version} introduced foreign key violations`);
    }
    database.prepare(
      'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
    ).run(migration.version, migration.checksum, new Date().toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    if (migration.requiresForeignKeysDisabled) {
      database.exec('PRAGMA foreign_keys = ON');
    }
  }
}
