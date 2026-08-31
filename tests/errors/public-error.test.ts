import { describe, expect, test } from 'vitest';
import { PublicError, toPublicError } from '../../src/errors/public-error.js';

describe('toPublicError', () => {
  test('does not expose cause metadata', () => {
    expect(toPublicError(new PublicError('provider_unavailable', 'Provider unavailable', {
      apiKey: 'secret-value', path: 'C:/Users/private/deals.sqlite',
    }))).toEqual({ code: 'provider_unavailable', message: 'Provider unavailable' });
  });

  test('does not expose unknown error messages', () => {
    expect(toPublicError(new Error('C:/Users/private/token=secret-value')))
      .toEqual({ code: 'internal_error', message: 'An unexpected error occurred' });
  });
});