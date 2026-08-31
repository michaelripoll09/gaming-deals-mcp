import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

interface Migration {
  readonly checksum: string;
  readonly sql: string;
  readonly version: number;
}

interface AppliedMigration {
  readonly checksum: string;
  readonly version: number;
}

const migrations: readonly Migration[] = [
  createMigration(1, new URL('./migrations/001_initial.sql', import.meta.url)),
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

function createMigration(version: number, source: URL): Migration {
  const sql = readFileSync(source, 'utf8');

  return {
    checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
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
  database.exec('BEGIN IMMEDIATE');

  try {
    database.exec(migration.sql);
    database.prepare(
      'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
    ).run(migration.version, migration.checksum, new Date().toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
