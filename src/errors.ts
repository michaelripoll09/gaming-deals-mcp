export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'DATABASE_MIGRATION_FAILED'
  | 'DATABASE_VERSION_UNSUPPORTED'
  | 'DATABASE_INTEGRITY_ERROR'
  | 'INPUT_INVALID';

const safeMessages: Record<ErrorCode, string> = {
  CONFIG_INVALID: 'Configuration is invalid',
  PERSISTENCE_UNAVAILABLE: 'Persistence is unavailable',
  DATABASE_MIGRATION_FAILED: 'Database migration failed',
  DATABASE_VERSION_UNSUPPORTED: 'Database version is unsupported',
  DATABASE_INTEGRITY_ERROR: 'Database integrity check failed',
  INPUT_INVALID: 'Input is invalid',
};

export class AppError extends Error {
  public readonly code: ErrorCode;

  public constructor(code: ErrorCode, _message: string, options?: ErrorOptions) {
    super(safeMessages[code], options);
    this.name = 'AppError';
    this.code = code;
  }

  public toJSON(): { code: ErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}
