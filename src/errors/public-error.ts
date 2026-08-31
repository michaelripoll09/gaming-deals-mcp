export const publicErrorCodes = [
  'invalid_configuration',
  'provider_unavailable',
  'provider_data_invalid',
  'ambiguous_mapping',
  'product_not_found',
  'region_incompatible',
  'persistence_failure',
  'internal_error',
] as const;

export type PublicErrorCode = (typeof publicErrorCodes)[number];

export interface PublicErrorEnvelope {
  code: PublicErrorCode;
  message: string;
}

export class PublicError extends Error {
  readonly code: PublicErrorCode;
  readonly cause?: unknown;

  constructor(code: PublicErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'PublicError';
    this.code = code;
    this.cause = cause;
  }
}

export function toPublicError(error: unknown): PublicErrorEnvelope {
  if (error instanceof PublicError) {
    return { code: error.code, message: error.message };
  }

  return {
    code: 'internal_error',
    message: 'An unexpected error occurred',
  };
}