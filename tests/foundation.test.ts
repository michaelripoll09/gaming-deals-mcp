import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { Money } from '../src/money.js';
import { createCoreServices } from '../src/core-services.js';
import { openDatabase } from '../src/persistence/sqlite.js';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
  it('resolves the default database path to an absolute path', () => {
    expect(loadConfig({}).databasePath).toBe(resolve('.gaming-deals/gaming-deals.sqlite'));
  });

  it('resolves a relative DATABASE_PATH override to an absolute path', () => {
    expect(loadConfig({ DATABASE_PATH: 'data/custom.sqlite' }).databasePath).toBe(
      resolve('data/custom.sqlite'),
    );
  });

  it('preserves the in-memory database sentinel', () => {
    expect(loadConfig({ DATABASE_PATH: ':memory:' }).databasePath).toBe(':memory:');
  });

  it('applies invocation overrides over persisted preferences over defaults', () => {
    const config = loadConfig(
      { DATABASE_PATH: '/ignored.sqlite', TELEGRAM_BOT_TOKEN: 'secret' },
      { country: 'GB' },
      { country: 'CA', currency: 'CAD' },
    );
    expect(config.country).toBe('GB');
    expect(config.currency).toBe('CAD');
    expect(config.databasePath).toBe(resolve('/ignored.sqlite'));
    expect(JSON.stringify(config)).not.toContain('secret');
    expect(config.timezone).toBe('UTC');
    expect(Object.keys(config)).toEqual(['country', 'currency', 'timezone', 'databasePath']);
  });

  it('requires structurally valid uppercase ISO alpha-2 country codes', () => {
    for (const country of ['U', 'USA', 'us', 'U1', ' U']) {
      expect(() => loadConfig({}, { country })).toThrow(AppError);
    }
    expect(loadConfig({}, { country: 'GB' }).country).toBe('GB');
  });

  it('rejects invalid settings without exposing submitted values', () => {
    expect(() => loadConfig({}, { country: 'not-a-country' })).toThrow(AppError);
    expect(() => loadConfig({}, { timezone: 'Mars/Olympus' })).toThrow(AppError);
    expect(() => loadConfig({}, { currency: 'ZZZ' })).toThrow(AppError);
    try {
      loadConfig({}, { country: 'us' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONFIG_INVALID', message: 'Configuration is invalid' });
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
    expect(db.prepare('SELECT version, name, checksum FROM schema_migrations').all()).toEqual([
      expect.objectContaining({
        version: 1,
        name: 'typed-settings',
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(db.prepare('PRAGMA table_info(app_settings)').all()).toEqual([
      expect.objectContaining({ name: 'key', type: 'TEXT', notnull: 1, pk: 1 }),
      expect.objectContaining({ name: 'value_json', type: 'TEXT', notnull: 1, pk: 0 }),
      expect.objectContaining({ name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0 }),
    ]);
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
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES ('country', '"us"', '2026-01-01T00:00:00.000Z')`,
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

  it('rejects corrupt JSON, invalid types, and unknown keys', () => {
    const db = openDatabase(':memory:');
    const services = createCoreServices({ database: db });
    expect(() => services.settings.set('unknown' as 'country', 'value')).toThrow(AppError);
    expect(() => services.settings.get('unknown' as 'country')).toThrow(AppError);
    db.prepare("UPDATE app_settings SET value_json = 'not-json' WHERE key = 'country'").run();
    expect(() => services.settings.get('country')).toThrow(AppError);
    db.prepare("UPDATE app_settings SET value_json = '42' WHERE key = 'country'").run();
    expect(() => services.settings.get('country')).toThrow(AppError);
    db.close();
  });

  it('rejects invalid persisted settings and leaves injected databases open', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at)
       VALUES ('country', '"us"', '2026-01-01T00:00:00.000Z')`,
    ).run();
    expect(() => createCoreServices({ database: db })).toThrow(AppError);
    expect(db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('country')).toEqual({
      value_json: '"us"',
    });
    db.close();
  });

  it('uses non-WAL mode for memory databases while verifying the remaining profile', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    db.close();
  });

  it('migrates one file safely from two synchronized Node child processes', async () => {
    const path = temporaryDatabase();
    const directory = mkdtempSync(join(process.cwd(), 'node_modules', 'migration-test-'));
    const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const { readFileSync } = await import('node:fs');
    const options = {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    };
    const errors = ts.transpileModule(
      readFileSync(join(sourceRoot, 'src/errors.ts'), 'utf8'),
      options,
    ).outputText;
    const sqlite = ts.transpileModule(
      readFileSync(join(sourceRoot, 'src/persistence/sqlite.ts'), 'utf8'),
      options,
    ).outputText;
    mkdirSync(join(directory, 'src/persistence'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, 'src/errors.js'), errors);
    writeFileSync(join(directory, 'src/persistence/sqlite.js'), sqlite);
    const children = [0, 1].map(() =>
      fork(
        join(sourceRoot, 'tests/fixtures/migration-worker.mjs'),
        [path, join(directory, 'src/persistence/sqlite.js')],
        { cwd: sourceRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
      ),
    );
    const listen = (child: ReturnType<typeof fork>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('migration process timed out after 15000ms')),
          15000,
        );
        child.on('message', (message: unknown) => {
          if (typeof message === 'object' && message !== null && 'ready' in message) return;
          if (typeof message === 'object' && message !== null && 'result' in message) {
            clearTimeout(timer);
            resolve(message as Record<string, unknown>);
          } else if (typeof message === 'object' && message !== null && 'error' in message) {
            clearTimeout(timer);
            reject(new Error(`migration process failed: ${JSON.stringify(message.error)}`));
          }
        });
        child.once('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timer);
            reject(new Error(`migration process exited with code ${code}`));
          }
        });
      });
    let readyCount = 0;
    for (const child of children) {
      child.on('message', (message: unknown) => {
        if (typeof message === 'object' && message !== null && 'ready' in message) {
          readyCount += 1;
          if (readyCount === children.length) {
            for (const contender of children) contender.send('start');
          }
        }
      });
    }
    const outcomes = children.map(listen);
    try {
      const results = await Promise.all(outcomes);
      expect(results).toHaveLength(2);
      const db = new Database(path);
      expect(db.prepare('SELECT version, name, checksum FROM schema_migrations').all()).toEqual([
        expect.objectContaining({
          version: 1,
          name: 'typed-settings',
          checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      const columns = db.prepare('PRAGMA table_info(app_settings)').all() as { name: string }[];
      expect(columns.map((column) => column.name)).toEqual(['key', 'value_json', 'updated_at']);
      expect(db.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      db.close();
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
      rmSync(directory, { recursive: true, force: true });
    }
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

  it.each([
    ['COMMIT', 'COMMIT;'],
    ['ROLLBACK', 'ROLLBACK;'],
    ['SAVEPOINT', 'SAVEPOINT migration_savepoint;'],
    ['RELEASE', 'RELEASE migration_savepoint;'],
    ['END', 'END;'],
  ])('rejects migration transaction control %s as invalid configuration', (_name, sql) => {
    const path = temporaryDatabase();
    let opened: Database.Database | undefined;
    let error: unknown;
    try {
      opened = openDatabase(path, { migrations: [{ version: 1, name: 'unsafe', sql }] });
    } catch (cause) {
      error = cause;
    } finally {
      opened?.close();
    }
    expect(error).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('rejects transaction control in multi-statement SQL before any migration effects', () => {
    const path = temporaryDatabase();
    const seed = openDatabase(path, { migrations: [] });
    seed.close();

    expect(() =>
      openDatabase(path, {
        migrations: [
          {
            version: 1,
            name: 'unsafe-sequence',
            sql: 'BEGIN; CREATE TABLE should_not_exist (id INTEGER); COMMIT;',
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));

    const db = new Database(path);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'should_not_exist'").get()).toBe(
      undefined,
    );
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([]);
    db.close();
  });

  it('allows forbidden words in comments, strings, and longer identifiers', () => {
    const db = openDatabase(':memory:', {
      migrations: [
        {
          version: 1,
          name: 'safe-keywords',
          sql: `-- BEGIN; COMMIT; ROLLBACK;
/* SAVEPOINT; RELEASE; END; */
            CREATE TABLE beginning_committee (
              ending TEXT DEFAULT 'BEGIN; COMMIT; ROLLBACK; SAVEPOINT; RELEASE; END; it''s safe',
              rollback_count INTEGER DEFAULT 0,
              "COMMIT; quoted" INTEGER,
              \`END; quoted\` INTEGER,
              [RELEASE; quoted] TEXT
            );
            CREATE TABLE savepoints_released (id INTEGER);`,
        },
      ],
    });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'beginning_committee'").get(),
    ).toEqual({ name: 'beginning_committee' });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'savepoints_released'").get(),
    ).toEqual({ name: 'savepoints_released' });
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    db.close();
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

  it('rejects non-finite, unsafe, and out-of-range clock timestamps', () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
      const db = openDatabase(':memory:');
      expect(() => createCoreServices({ database: db, clock: { now: () => now } })).toThrow(
        AppError,
      );
      db.close();
    }
  });

  it('writes setting timestamps as UTC ISO strings', async () => {
    const path = temporaryDatabase();
    const services = createCoreServices({
      env: { DATABASE_PATH: path },
      clock: { now: () => Date.parse('2026-03-01T12:30:45.000Z') },
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
    expect(services.config.timezone).toBe('UTC');
    expect(services.clock.now()).toEqual(expect.any(Number));
    expect(services.settings.get('country')).toBe('US');
    services.settings.set('country', 'GB');
    expect(services.settings.get('country')).toBe('GB');
    expect(() => services.settings.set('unknown' as 'country', 'value')).toThrow(AppError);
    expect(() => services.settings.set('currency', 'usd')).toThrow(AppError);
    expect(services.settings.snapshot()).toEqual({
      country: 'GB',
      currency: 'USD',
      timezone: 'UTC',
    });
    expect(services.settings.get('country')).toBe('GB');
    await services.close();
    await services.close();
    expect(() => services.settings.get('country')).toThrow(AppError);
  });
});
