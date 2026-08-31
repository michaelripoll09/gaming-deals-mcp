import { afterEach, describe, expect, test } from 'vitest';
import { runDoctor } from '../../src/cli/doctor.js';
import { createTemporaryDatabase, type TemporaryDatabase } from '../helpers/temp-database.js';

const databases: TemporaryDatabase[] = [];

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
});