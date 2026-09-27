import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { Money } from '../src/money.js';
import { createCoreServices } from '../src/core-services.js';
import { openDatabase } from '../src/persistence/sqlite.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gaming-deals-'));
  temporaryDirectories.push(directory);
  return join(directory, 'foundation.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Foundation configuration', () => {
  it('applies invocation overrides over persisted preferences over defaults', () => {
    const config = loadConfig(
      { DATABASE_PATH: '/ignored.sqlite', ITAD_API_KEY: 'secret' },
      { country: 'GB' },
      { country: 'CA', currency: 'CAD' },
    );
    expect(config.country).toBe('GB');
    expect(config.currency).toBe('CAD');
    expect(config.databasePath).toBe('/ignored.sqlite');
    expect(config.secrets).toEqual({ itadApiKey: 'secret' });
    expect(JSON.stringify(config)).not.toContain('secret');
  });

  it('requires structurally valid uppercase ISO alpha-2 country codes', () => {
    for (const country of ['U', 'USA', 'us', 'U1', ' U']) {
      expect(() => loadConfig({}, { country })).toThrow(AppError);
    }
    expect(loadConfig({}, { country: 'GB' }).country).toBe('GB');
  });

  it('rejects invalid settings without exposing submitted values', () => {
    expect(() => loadConfig({ ITAD_API_KEY: 'private' }, { country: 'not-a-country' })).toThrow(
      AppError,
    );
    expect(() => loadConfig({}, { timeZone: 'Mars/Olympus' })).toThrow(AppError);
    expect(() => loadConfig({}, { currency: 'ZZZ' })).toThrow(AppError);
    try {
      loadConfig({}, { country: 'us' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONFIG_INVALID', message: 'Configuration is invalid' });
    }
    try {
      loadConfig({ ITAD_API_KEY: 'private' }, { country: 'not-a-country' });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('private');
    }
  });
});

describe('safe errors and money', () => {
  it('serializes only stable safe error details and retains causes non-enumerably', () => {
    const sensitive = '/private/path.sqlite token=abc SELECT * FROM users';
    const cause = new Error(sensitive);
    const error = new AppError('PERSISTENCE_UNAVAILABLE', sensitive, { cause });
    expect(error.toJSON()).toEqual({
      code: 'PERSISTENCE_UNAVAILABLE',
      message: 'Persistence is unavailable',
    });
    expect(JSON.stringify(error)).not.toContain('/private');
    expect(JSON.stringify(error)).not.toContain('SELECT');
    expect(Object.keys(error)).not.toContain('cause');
    expect(error.cause).toBe(cause);
  });

  it('uses safe integer minor units and ISO currency codes', () => {
    expect(Money.create(1999, 'USD')).toEqual({ amountMinor: 1999, currency: 'USD' });
    expect(() => Money.create(1.5, 'USD')).toThrow(AppError);
    expect(() => Money.create(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(AppError);
    expect(() => Money.create(1, 'ZZZ')).toThrow(AppError);
    expect(Money.create(123, 'JPY')).toEqual({ amountMinor: 123, currency: 'JPY' });
  });
});

describe('SQLite foundation', () => {
  it('applies the operational profile and checksummed migrations', () => {
    const db = openDatabase(temporaryDatabase());
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    expect(db.prepare('SELECT version, checksum FROM schema_migrations').all()).toHaveLength(1);
    const contender = openDatabase(db.name);
    expect(contender.prepare('SELECT version FROM schema_migrations').all()).toHaveLength(1);
    contender.close();
    db.close();
  });

  it('closes an owned database when persisted settings fail validation', () => {
    const path = temporaryDatabase();
    const seed = openDatabase(path);
    seed
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('country', 'us', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    seed.close();
    const closeSpy = vi.spyOn(Database.prototype, 'close');
    try {
      expect(() => createCoreServices({ env: { DATABASE_PATH: path } })).toThrow(AppError);
      expect(closeSpy).toHaveBeenCalledOnce();
    } finally {
      closeSpy.mockRestore();
    }
  });

  it('rejects invalid persisted settings and leaves injected databases open', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('country', 'us', '2026-01-01T00:00:00.000Z')",
    ).run();
    expect(() => createCoreServices({ database: db })).toThrow(AppError);
    expect(db.prepare('SELECT value FROM app_settings WHERE key = ?').get('country')).toEqual({
      value: 'us',
    });
    db.close();
  });

  it('uses a non-WAL journal mode for memory databases while verifying the remaining profile', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    db.close();
  });

  it('serializes multiple file-backed startup connections without partial migration rows', () => {
    const path = temporaryDatabase();
    const migrations = [
      { version: 1, name: 'first', sql: 'CREATE TABLE first_table (id INTEGER)' },
      { version: 2, name: 'second', sql: 'CREATE TABLE second_table (id INTEGER)' },
    ];
    const first = openDatabase(path, { migrations, busyTimeoutMs: 1000 });
    const second = openDatabase(path, { migrations, busyTimeoutMs: 1000 });
    expect(first.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    expect(
      second.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_table'").all(),
    ).toHaveLength(2);
    first.close();
    second.close();
  });

  it('bounds migration startup under an exclusive file lock without partial rows', () => {
    const path = temporaryDatabase();
    const holder = openDatabase(path, { migrations: [] });
    holder.exec('BEGIN EXCLUSIVE');
    expect(() =>
      openDatabase(path, {
        busyTimeoutMs: 50,
        migrations: [{ version: 1, name: 'locked', sql: 'CREATE TABLE locked_table (id INTEGER)' }],
      }),
    ).toThrow(AppError);
    holder.exec('ROLLBACK');
    expect(holder.prepare('SELECT version FROM schema_migrations').all()).toEqual([]);
    expect(
      holder.prepare("SELECT name FROM sqlite_master WHERE name = 'locked_table'").get(),
    ).toBeUndefined();
    holder.close();
  });

  it('rejects migration drift and future schemas without leaking database content', () => {
    const path = temporaryDatabase();
    const first = openDatabase(path);
    first.exec("UPDATE schema_migrations SET checksum = 'tampered'");
    first.close();
    expect(() => openDatabase(path)).toThrow(
      expect.objectContaining({ code: 'DATABASE_INTEGRITY_ERROR' }),
    );

    const futurePath = temporaryDatabase();
    const future = openDatabase(futurePath);
    future.exec('UPDATE schema_migrations SET version = 999');
    future.close();
    expect(() => openDatabase(futurePath)).toThrow(
      expect.objectContaining({ code: 'DATABASE_VERSION_UNSUPPORTED' }),
    );
  });

  it('rolls a failed migration back atomically', () => {
    const path = temporaryDatabase();
    expect(() =>
      openDatabase(path, {
        migrations: [
          { version: 1, name: 'valid', sql: 'CREATE TABLE first_table (id INTEGER)' },
          { version: 2, name: 'broken', sql: 'CREATE TABLE broken (' },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'DATABASE_MIGRATION_FAILED' }));
    const db = openDatabase(path, { migrations: [] });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'first_table'").get()).toBe(
      undefined,
    );
    db.close();
  });
});

describe('Core services lifecycle', () => {
  it('does not close injected databases during normal shutdown', async () => {
    const db = openDatabase(':memory:');
    const services = createCoreServices({ database: db });
    await services.close();
    expect(db.prepare('SELECT 1 AS alive').get()).toEqual({ alive: 1 });
    db.close();
  });

  it('writes setting timestamps as UTC ISO strings', async () => {
    const path = temporaryDatabase();
    const services = createCoreServices({
      env: { DATABASE_PATH: path },
      clock: { now: () => '2026-03-01T12:30:45.000Z' },
    });
    services.settings.set('country', 'CA');
    expect(services.settings.snapshot().country).toBe('CA');
    await services.close();
    const db = openDatabase(path);
    expect(db.prepare('SELECT updated_at FROM app_settings WHERE key = ?').get('country')).toEqual({
      updated_at: '2026-03-01T12:30:45.000Z',
    });
    db.close();
  });

  it('does not create a database as an import side effect', async () => {
    const path = temporaryDatabase();
    const previous = process.env['DATABASE_PATH'];
    process.env['DATABASE_PATH'] = path;
    try {
      await import('../src/index.js');
      expect(existsSync(path)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env['DATABASE_PATH'];
      else process.env['DATABASE_PATH'] = previous;
    }
  });

  it('owns validated config, database, and clock and closes idempotently', async () => {
    const services = createCoreServices({
      env: { DATABASE_PATH: temporaryDatabase() },
    });
    expect(services.config.timeZone).toBe('UTC');
    expect(services.clock.now()).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(services.settings.get('country')).toBe('US');
    services.settings.set('country', 'GB');
    expect(services.settings.get('country')).toBe('GB');
    expect(() => services.settings.set('unknown' as 'country', 'value')).toThrow(AppError);
    expect(() => services.settings.set('currency', 'usd')).toThrow(AppError);
    expect(services.settings.snapshot()).toEqual({
      country: 'GB',
      currency: 'USD',
      timeZone: 'UTC',
    });
    expect(services.settings.get('country')).toBe('GB');
    await services.close();
    await services.close();
    expect(() => services.settings.get('country')).toThrow(AppError);
  });
});
