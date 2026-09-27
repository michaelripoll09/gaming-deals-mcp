import { AppError } from './errors.js';

export interface MoneyAmount {
  readonly amountMinor: number;
  readonly currency: string;
}

export const Money = {
  create(amountMinor: number, currency: string): MoneyAmount {
    if (!Number.isSafeInteger(amountMinor) || !isCurrency(currency)) {
      throw new AppError('INPUT_INVALID', 'Money amount is invalid');
    }
    return Object.freeze({ amountMinor, currency });
  },
};

function isCurrency(currency: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false;
  try {
    return Intl.supportedValuesOf('currency').includes(currency);
  } catch {
    return false;
  }
}
