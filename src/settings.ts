import type Database from 'better-sqlite3';
import { AppError } from './errors.js';

export type SettingKey = 'country' | 'currency' | 'timezone';
export type Settings = Readonly<Record<SettingKey, string>>;
const defaults: Settings = { country: 'US', currency: 'USD', timezone: 'UTC' };
const settingKeys: readonly SettingKey[] = ['country', 'currency', 'timezone'];

export class SettingsStore {
  public constructor(
    private readonly db: Database.Database,
    private readonly isClosed: () => boolean,
    private readonly now: () => number,
  ) {
    try {
      const insert = db.prepare(
        'INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
      );
      for (const [key, value] of Object.entries(defaults)) {
        insert.run(key, JSON.stringify(value), timestamp(this.now()));
      }
    } catch (cause) {
      throw persistenceError(cause);
    }
  }

  public get(key: SettingKey): string {
    this.assertOpen();
    this.assertKnownKey(key);
    try {
      const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
        { value_json: string } | undefined;
      if (!row) {
        throw new AppError('PERSISTENCE_UNAVAILABLE', 'A required setting is unavailable');
      }
      let value: unknown;
      try {
        value = JSON.parse(row.value_json) as unknown;
      } catch (cause) {
        throw new AppError('PERSISTENCE_UNAVAILABLE', 'Stored setting is invalid', { cause });
      }
      if (typeof value !== 'string' || !validSetting(key, value)) {
        throw new AppError('PERSISTENCE_UNAVAILABLE', 'Stored setting is invalid');
      }
      return value;
    } catch (cause) {
      throw persistenceError(cause);
    }
  }

  public set(key: SettingKey, value: string): void {
    this.assertOpen();
    this.assertKnownKey(key);
    if (!validSetting(key, value)) {
      throw new AppError('INPUT_INVALID', 'Setting value is invalid');
    }
    try {
      this.db
        .prepare(
          `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
        )
        .run(key, JSON.stringify(value), timestamp(this.now()));
    } catch (cause) {
      throw persistenceError(cause);
    }
  }

  public snapshot(): Settings {
    return {
      country: this.get('country'),
      currency: this.get('currency'),
      timezone: this.get('timezone'),
    };
  }

  private assertKnownKey(key: string): asserts key is SettingKey {
    if (!settingKeys.includes(key as SettingKey)) {
      throw new AppError('INPUT_INVALID', 'Setting key is invalid');
    }
  }

  private assertOpen(): void {
    if (this.isClosed()) throw new AppError('PERSISTENCE_UNAVAILABLE', 'Core services are closed');
  }
}

function timestamp(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new AppError('CONFIG_INVALID', 'Clock timestamp is invalid');
  }
  try {
    return new Date(value).toISOString();
  } catch (cause) {
    throw new AppError('CONFIG_INVALID', 'Clock timestamp is invalid', { cause });
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
    return key === 'timezone';
  } catch {
    return false;
  }
}
