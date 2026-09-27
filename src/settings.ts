import type Database from 'better-sqlite3';
import { AppError } from './errors.js';

export type SettingKey = 'country' | 'currency' | 'timeZone';
export type Settings = Readonly<Record<SettingKey, string>>;
const defaults: Settings = { country: 'US', currency: 'USD', timeZone: 'UTC' };

export class SettingsStore {
  public constructor(
    private readonly db: Database.Database,
    private readonly isClosed: () => boolean,
    private readonly now: () => string,
  ) {
    try {
      const insert = db.prepare(
        'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
      );
      for (const [key, value] of Object.entries(defaults)) insert.run(key, value, now());
    } catch (cause) {
      throw persistenceError(cause);
    }
  }

  public get(key: SettingKey): string {
    this.assertOpen();
    try {
      const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
        { value: string } | undefined;
      if (!row) throw new AppError('PERSISTENCE_UNAVAILABLE', 'A required setting is unavailable');
      return row.value;
    } catch (cause) {
      throw persistenceError(cause);
    }
  }

  public set(key: SettingKey, value: string): void {
    this.assertOpen();
    if (!validSetting(key, value)) {
      throw new AppError('INPUT_INVALID', 'Setting value is invalid');
    }
    try {
      this.db
        .prepare(
          'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(key, value, this.now());
    } catch (cause) {
      throw persistenceError(cause);
    }
  }

  public snapshot(): Settings {
    return {
      country: this.get('country'),
      currency: this.get('currency'),
      timeZone: this.get('timeZone'),
    };
  }

  private assertOpen(): void {
    if (this.isClosed()) throw new AppError('PERSISTENCE_UNAVAILABLE', 'Core services are closed');
  }
}

function persistenceError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  return new AppError('PERSISTENCE_UNAVAILABLE', 'Settings persistence failed', { cause });
}

function validSetting(key: SettingKey, value: string): boolean {
  if (key === 'country') return /^[A-Z]{2}$/.test(value);
  if (key === 'currency') {
    return /^[A-Z]{3}$/.test(value) && Intl.supportedValuesOf('currency').includes(value);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return key === 'timeZone';
  } catch {
    return false;
  }
}
