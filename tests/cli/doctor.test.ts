import { afterEach, describe, expect, test } from 'vitest';
import { runDoctor } from '../../src/cli/doctor.js';
import { createTemporaryDatabase, type TemporaryDatabase } from '../helpers/temp-database.js';

const databases: TemporaryDatabase[] = [];
const unsafeValue = 'C:/Users/private/gaming-deals.sqlite secret-value raw diagnostic detail';

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.cleanup();
  }
});

describe('runDoctor', () => {
  test('reports a healthy runtime without secrets or database paths', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const result = await runDoctor({
      environment: {
        GAMING_DEALS_DATABASE_PATH: database.path,
        GAMING_DEALS_PROVIDER_API_KEY: 'secret-value',
      },
      stdout: (line) => lines.push(line),
    });

    expect(result).toBe('healthy');
    expect(lines).toEqual([
      'configuration: healthy',
      'migrations: readable',
      'sqlite: writable',
      'deterministic_provider: healthy',
    ]);
    expect(lines.join('\n')).not.toContain('secret-value');
    expect(lines.join('\n')).not.toContain(database.path);
  });

  test('reports invalid configuration as a bounded failure', async () => {
    const lines: string[] = [];

    const result = await runDoctor({
      environment: { GAMING_DEALS_COMPARISON_CURRENCY: 'COPP' },
      stdout: (line) => lines.push(line),
    });

    expect(result).toBe('unhealthy');
    expect(lines).toEqual(['configuration: unhealthy (invalid_configuration)']);
  });

  test('bounds an injected database-open exception without leaking its details', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const result = await runDoctor({
      environment: doctorEnvironment(database.path),
      stdout: (line) => lines.push(line),
      dependencies: {
        openDatabase: () => {
          throw new Error(unsafeValue);
        },
      },
    });

    expect(result).toBe('unhealthy');
    expect(lines).toEqual(['configuration: healthy', 'sqlite: unhealthy (persistence_failure)']);
    expect(lines.join('\n')).not.toContain(unsafeValue);
  });

  test('bounds an injected migration-metadata exception without leaking its details', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const result = await runDoctor({
      environment: doctorEnvironment(database.path),
      stdout: (line) => lines.push(line),
      dependencies: {
        openDatabase: () => fakeDatabase({ migrationError: new Error(unsafeValue) }),
      },
    });

    expect(result).toBe('unhealthy');
    expect(lines).toEqual(['configuration: healthy', 'migrations: unhealthy (persistence_failure)']);
    expect(lines.join('\n')).not.toContain(unsafeValue);
  });

  test('bounds an injected database-probe exception without leaking its details', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const result = await runDoctor({
      environment: doctorEnvironment(database.path),
      stdout: (line) => lines.push(line),
      dependencies: {
        openDatabase: () => fakeDatabase({ probeError: new Error(unsafeValue) }),
      },
    });

    expect(result).toBe('unhealthy');
    expect(lines).toEqual([
      'configuration: healthy',
      'migrations: readable',
      'sqlite: unhealthy (persistence_failure)',
    ]);
    expect(lines.join('\n')).not.toContain(unsafeValue);
  });

  test('bounds an injected deterministic capability failure without leaking its details', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const result = await runDoctor({
      environment: doctorEnvironment(database.path),
      stdout: (line) => lines.push(line),
      dependencies: {
        createDeterministicProvider: () => ({
          get capability() {
            throw new Error(unsafeValue);
          },
          sync: async () => ({}) as unknown,
        }),
      },
    });

    expect(result).toBe('unhealthy');
    expect(lines).toEqual([
      'configuration: healthy',
      'migrations: readable',
      'sqlite: writable',
      'deterministic_provider: unhealthy (provider_data_invalid)',
    ]);
    expect(lines.join('\n')).not.toContain(unsafeValue);
  });

  test('bounds an injected deterministic sync exception without leaking its details', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const result = await runDoctor({
      environment: doctorEnvironment(database.path),
      stdout: (line) => lines.push(line),
      dependencies: {
        createDeterministicProvider: () => ({
          capability: validCapability(),
          sync: async () => {
            throw new Error(unsafeValue);
          },
        }),
      },
    });

    expect(result).toBe('unhealthy');
    expect(lines).toEqual([
      'configuration: healthy',
      'migrations: readable',
      'sqlite: writable',
      'deterministic_provider: unhealthy (provider_data_invalid)',
    ]);
    expect(lines.join('\n')).not.toContain(unsafeValue);
  });
});

function doctorEnvironment(databasePath: string): NodeJS.ProcessEnv {
  return {
    GAMING_DEALS_DATABASE_PATH: databasePath,
    GAMING_DEALS_PROVIDER_API_KEY: unsafeValue,
  };
}

function fakeDatabase(input: { migrationError?: Error; probeError?: Error }) {
  return {
    database: {
      exec: (sql: string) => {
        if (sql === 'BEGIN IMMEDIATE' && input.probeError !== undefined) {
          throw input.probeError;
        }
      },
      prepare: (sql: string) => {
        if (sql.includes('schema_migrations') && input.migrationError !== undefined) {
          throw input.migrationError;
        }
        if (sql.startsWith('SELECT value')) {
          return { get: () => ({ value: 'probe' }) };
        }
        if (sql.includes('schema_migrations')) {
          return { all: () => [] };
        }
        return { run: () => undefined };
      },
    },
    close: () => undefined,
  };
}

function validCapability() {
  return {
    providerId: 'deterministic',
    displayName: 'Deterministic Fixture Provider',
    retailerClass: 'authorized_store' as const,
    sourceConfidence: 'high' as const,
    supportedCountries: ['CO'],
    authentication: 'none' as const,
    enabledByDefault: true,
  };
}
