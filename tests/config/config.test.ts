import { describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config/config.js';

describe('loadConfig', () => {
  test('uses CO and COP defaults', () => {
    expect(loadConfig({ GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite' }))
      .toMatchObject({ country: 'CO', comparisonCurrency: 'COP', databasePath: 'C:/tmp/deals.sqlite' });
  });

  test('rejects an invalid comparison currency', () => {
    expect(() => loadConfig({
      GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite',
      GAMING_DEALS_COMPARISON_CURRENCY: 'COPP',
    })).toThrow('Invalid configuration');
  });
});