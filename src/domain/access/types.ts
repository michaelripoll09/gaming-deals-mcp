import { z } from 'zod';
import { isoTimestampSchema } from '../offers/types.js';

export type AccessState = 'owned' | 'subscription_access' | 'loan';
export type AccessProvenance = 'manual';

export interface AccessRecord {
  id: string;
  productVariantId: string;
  state: AccessState;
  provenance: AccessProvenance;
  activeFrom: string | null;
  activeUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseAccess =
  | { kind: 'owned'; activeRecords: AccessRecord[] }
  | { kind: 'temporary_access'; activeRecords: AccessRecord[] }
  | { kind: 'none'; activeRecords: [] };

const toEpoch = (timestamp: string): number => Date.parse(timestamp);

export const accessRecordSchema: z.ZodType<AccessRecord> = z.object({
  id: z.uuid(),
  productVariantId: z.uuid(),
  state: z.enum(['owned', 'subscription_access', 'loan']),
  provenance: z.literal('manual'),
  activeFrom: isoTimestampSchema.nullable(),
  activeUntil: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
}).strict().refine(({ activeFrom, activeUntil }) => (
  activeFrom === null
  || activeUntil === null
  || toEpoch(activeUntil) > toEpoch(activeFrom)
), { message: 'activeUntil must be later than activeFrom' });

export function activeAccessRecords(records: AccessRecord[], evaluatedAt: string): AccessRecord[] {
  const evaluatedAtEpoch = toEpoch(evaluatedAt);

  return records
    .filter(({ activeFrom, activeUntil }) => (
      (activeFrom === null || toEpoch(activeFrom) <= evaluatedAtEpoch)
      && (activeUntil === null || evaluatedAtEpoch < toEpoch(activeUntil))
    ))
    .map((record) => ({ ...record }));
}

export function derivePurchaseAccess(records: AccessRecord[], evaluatedAt: string): PurchaseAccess {
  const activeRecords = activeAccessRecords(records, evaluatedAt);

  if (activeRecords.some(({ state }) => state === 'owned')) {
    return { kind: 'owned', activeRecords };
  }

  if (activeRecords.length > 0) {
    return { kind: 'temporary_access', activeRecords };
  }

  return { kind: 'none', activeRecords: [] };
}