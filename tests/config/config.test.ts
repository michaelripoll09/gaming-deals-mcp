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

  test('normalizes lowercase country and comparison currency', () => {
    expect(loadConfig({
      GAMING_DEALS_COUNTRY: 'co',
      GAMING_DEALS_COMPARISON_CURRENCY: 'cop',
      GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite',
    })).toMatchObject({ country: 'CO', comparisonCurrency: 'COP' });
  });

  test('rejects malformed or empty country and comparison currency codes', () => {
    expect(() => loadConfig({
      GAMING_DEALS_COUNTRY: '$$',
      GAMING_DEALS_COMPARISON_CURRENCY: '12!',
      GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite',
    })).toThrow('Invalid configuration');

    expect(() => loadConfig({
      GAMING_DEALS_COUNTRY: '',
      GAMING_DEALS_COMPARISON_CURRENCY: '',
      GAMING_DEALS_DATABASE_PATH: 'C:/tmp/deals.sqlite',
    })).toThrow('Invalid configuration');
  });
});
