import { describe, expect, test } from 'vitest';
import {
  accessRecordSchema,
  activeAccessRecords,
  derivePurchaseAccess,
  type AccessRecord,
} from '../../src/domain/access/types.js';

const ids = {
  owned: '0d8e1148-3768-49c9-bfa3-7cd0e02b37bf',
  subscription: '945f237d-bd35-4539-937e-2c6dd2b67385',
  loan: 'f4b73a10-75b0-4707-a029-1bfd6c4420e7',
  variant: '4b694436-8c1a-4a4a-a143-30bec4798d06',
};
const now = '2026-09-01T12:00:00.000Z';
const record = (overrides: Partial<AccessRecord> = {}): AccessRecord => ({
  id: ids.loan,
  productVariantId: ids.variant,
  state: 'loan',
  provenance: 'manual',
  activeFrom: null,
  activeUntil: null,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
  ...overrides,
});

const owned = record({ id: ids.owned, state: 'owned' });
const subscription = record({ id: ids.subscription, state: 'subscription_access' });
const loan = record();

describe('accessRecordSchema', () => {
  test('accepts all access states with nullable bounds', () => {
    for (const state of ['owned', 'subscription_access', 'loan'] as const) {
      expect(accessRecordSchema.safeParse(record({ state })).success).toBe(true);
    }
  });

  test('rejects unknown keys, invalid UUIDs, and invalid ISO timestamps', () => {
    expect(accessRecordSchema.safeParse({ ...loan, typo: true }).success).toBe(false);
    expect(accessRecordSchema.safeParse({ ...loan, id: 'not-a-uuid' }).success).toBe(false);
    expect(accessRecordSchema.safeParse({ ...loan, createdAt: '2026-08-30' }).success).toBe(false);
  });

  test('rejects an interval whose end is not later than its start', () => {
    expect(() => accessRecordSchema.parse({ ...loan, activeFrom: now, activeUntil: now })).toThrow();
  });

  test('accepts an interval whose offset timestamps are chronologically ordered', () => {
    expect(accessRecordSchema.safeParse({
      ...loan,
      activeFrom: '2026-09-01T15:00:00+03:00',
      activeUntil: '2026-09-01T12:30:00Z',
    }).success).toBe(true);
  });
});

describe('activeAccessRecords', () => {
  test('includes unbounded access and excludes future and expired records', () => {
    const result = activeAccessRecords([
      owned,
      record({ id: ids.subscription, activeFrom: '2026-09-01T12:00:00.001Z' }),
      record({ id: '47426d0c-9c83-4685-a49c-44f085fc07cd', activeUntil: now }),
    ], now);

    expect(result).toEqual([owned]);
  });

  test('uses parsed instants rather than lexical timestamp order', () => {
    const result = activeAccessRecords([
      record({
        activeFrom: '2026-09-01T10:00:00-03:00',
        activeUntil: '2026-09-01T13:00:00Z',
      }),
    ], '2026-09-01T12:30:00Z');

    expect(result).toHaveLength(0);
  });

  test('returns clones rather than references to active records', () => {
    const result = activeAccessRecords([owned], now);
    expect(result[0]).not.toBe(owned);
    expect(result[0]).toEqual(owned);
  });
});

describe('derivePurchaseAccess', () => {
  test('treats activeUntil as exclusive and owned as stronger than temporary access', () => {
    expect(derivePurchaseAccess([owned, subscription], now)).toMatchObject({ kind: 'owned' });
    const loanEndingNow = record({ activeUntil: now });
    expect(derivePurchaseAccess([loanEndingNow], loanEndingNow.activeUntil!)).toEqual({ kind: 'none', activeRecords: [] });
  });

  test('returns temporary access for active subscription and loan records', () => {
    const result = derivePurchaseAccess([subscription, loan], now);
    expect(result).toEqual({ kind: 'temporary_access', activeRecords: [subscription, loan] });
  });

  test('returns none when there are no active records', () => {
    expect(derivePurchaseAccess([], now)).toEqual({ kind: 'none', activeRecords: [] });
  });

  test('returns cloned active records in purchase access', () => {
    const result = derivePurchaseAccess([owned], now);
    expect(result.kind).toBe('owned');
    if (result.kind === 'owned') expect(result.activeRecords[0]).not.toBe(owned);
  });
});