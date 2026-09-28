export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'DATABASE_MIGRATION_FAILED'
  | 'DATABASE_VERSION_UNSUPPORTED'
  | 'DATABASE_INTEGRITY_ERROR'
  | 'INPUT_INVALID'
  | 'PROVIDER_CANCELLED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_AUTHENTICATION_REQUIRED'
  | 'PROVIDER_MALFORMED_UPSTREAM'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REQUEST_REJECTED';

const safeMessages: Record<ErrorCode, string> = {
  CONFIG_INVALID: 'Configuration is invalid',
  PERSISTENCE_UNAVAILABLE: 'Persistence is unavailable',
  DATABASE_MIGRATION_FAILED: 'Database migration failed',
  DATABASE_VERSION_UNSUPPORTED: 'Database version is unsupported',
  DATABASE_INTEGRITY_ERROR: 'Database integrity check failed',
  INPUT_INVALID: 'Input is invalid',
  PROVIDER_CANCELLED: 'Provider request was cancelled',
  PROVIDER_TIMEOUT: 'Provider request timed out',
  PROVIDER_RATE_LIMITED: 'Provider rate limit was reached',
  PROVIDER_AUTHENTICATION_REQUIRED: 'Provider authentication is required',
  PROVIDER_MALFORMED_UPSTREAM: 'Provider returned an invalid response',
  PROVIDER_UNAVAILABLE: 'Provider is unavailable',
  PROVIDER_REQUEST_REJECTED: 'Provider rejected the request',
};

export class AppError extends Error {
  public readonly code: ErrorCode;

  public constructor(code: ErrorCode, _message: string, options?: ErrorOptions) {
    super(safeMessages[code], options);
    this.name = 'AppError';
    this.code = code;
  }

  public toJSON(): { code: ErrorCode; message: string } {
    return { code: this.code, message: safeMessages[this.code] };
  }
}
