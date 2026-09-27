import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { AppError } from '../errors.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface OpenDatabaseOptions {
  readonly migrations?: readonly Migration[];
  readonly busyTimeoutMs?: number;
}

const defaultMigrations: readonly Migration[] = [
  {
    version: 1,
    name: 'typed-settings',
    sql: `CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`,
  },
];

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Database.Database {
  let db: Database.Database | undefined;
  try {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    db = new Database(path);
    const busyTimeoutMs = validBusyTimeout(options.busyTimeoutMs ?? 5000);
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    setWalJournalMode(db, busyTimeoutMs);
    db.pragma('synchronous = NORMAL');
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    const journalMode = db.pragma('journal_mode', { simple: true });
    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    const synchronous = db.pragma('synchronous', { simple: true });
    if (
      foreignKeys !== 1 ||
      busyTimeout !== busyTimeoutMs ||
      synchronous !== 1 ||
      (path === ':memory:' ? journalMode !== 'memory' : journalMode !== 'wal')
    ) {
      throw new AppError('PERSISTENCE_UNAVAILABLE', 'SQLite profile could not be verified');
    }
    try {
      applyMigrations(db, options.migrations ?? defaultMigrations);
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError('DATABASE_MIGRATION_FAILED', 'Database migration failed', { cause });
    }
    return db;
  } catch (cause) {
    try {
      db?.close();
    } catch {
      // Preserve the original safe persistence error.
    }
    if (cause instanceof AppError) throw cause;
    throw new AppError('PERSISTENCE_UNAVAILABLE', 'Database initialization failed', { cause });
  }
}

function setWalJournalMode(db: Database.Database, busyTimeoutMs: number): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      db.pragma('journal_mode = WAL');
      return;
    } catch (error) {
      if (attempt > 0 || !isSqliteBusy(error)) throw error;
      // The pragma's configured busy timeout is honored on each attempt; this
      // short fixed pause lets a competing process finish its startup transition.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(25, busyTimeoutMs));
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_BUSY'
  );
}

function validBusyTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 60000) {
    throw new AppError('CONFIG_INVALID', 'SQLite busy timeout is invalid');
  }
  return value;
}

function applyMigrations(db: Database.Database, migrations: readonly Migration[]): void {
  validateMigrations(migrations);
  const transaction = db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    const rows = db
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all() as { version: number; name: string; checksum: string }[];
    const latestKnown = migrations.at(-1)?.version ?? 0;
    if ((rows.at(-1)?.version ?? 0) > latestKnown) {
      throw new AppError(
        'DATABASE_VERSION_UNSUPPORTED',
        'Database schema version is newer than this program',
      );
    }
    for (const row of rows) {
      const migration = migrations.find((candidate) => candidate.version === row.version);
      if (!migration || migration.name !== row.name || checksum(migration) !== row.checksum) {
        throw new AppError(
          'DATABASE_INTEGRITY_ERROR',
          'Database migration checksum validation failed',
        );
      }
    }
    const applied = new Set(rows.map((row) => row.version));
    const insert = db.prepare(
      'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, checksum(migration), new Date().toISOString());
    }
  });
  transaction.exclusive();
}

function validateMigrations(migrations: readonly Migration[]): void {
  const versions = migrations.map((migration) => migration.version);
  if (
    versions.some((version, index) => !Number.isSafeInteger(version) || version !== index + 1) ||
    migrations.some((migration) => !migration.name.trim() || !migration.sql.trim())
  ) {
    throw new AppError('CONFIG_INVALID', 'Migration definitions are invalid');
  }
}

function checksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.version}\0${migration.name}\0${migration.sql}`)
    .digest('hex');
}
