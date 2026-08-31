import { afterEach, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/main.js';
import { createTemporaryDatabase, type TemporaryDatabase } from '../helpers/temp-database.js';

const databases: TemporaryDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.cleanup();
  }
});

describe('runCli', () => {
  test('prints bounded usage and exits two for an unknown command', async () => {
    const lines: string[] = [];

    const exitCode = await runCli(['unknown'], {}, (line) => lines.push(line));

    expect(exitCode).toBe(2);
    expect(lines).toEqual(['Usage: gaming-deals <doctor|mcp>']);
  });

  test('runs doctor and maps a healthy result to zero', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const exitCode = await runCli(['doctor'], {
      GAMING_DEALS_DATABASE_PATH: database.path,
    }, (line) => lines.push(line));

    expect(exitCode).toBe(0);
    expect(lines).toContain('configuration: healthy');
  });

  test('runs doctor and maps an unhealthy result to one', async () => {
    const lines: string[] = [];

    const exitCode = await runCli(['doctor'], {
      GAMING_DEALS_COMPARISON_CURRENCY: 'COPP',
    }, (line) => lines.push(line));

    expect(exitCode).toBe(1);
    expect(lines).toEqual(['configuration: unhealthy (invalid_configuration)']);
  });
});