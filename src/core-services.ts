import type Database from 'better-sqlite3';
import { loadConfig, type AppConfig } from './config.js';
import { AppError } from './errors.js';
import { openDatabase } from './persistence/sqlite.js';
import { SettingsStore } from './settings.js';

export interface Clock {
  now(): string;
}

export interface CoreServices {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly settings: SettingsStore;
  close(): Promise<void>;
}

export interface CoreServicesOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly database?: Database.Database;
}

export function createCoreServices(options: CoreServicesOptions = {}): CoreServices {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const env = options.env ?? process.env;
  const bootstrapConfig = loadConfig(env);
  const ownsDatabase = options.database === undefined;
  const db = options.database ?? openDatabase(bootstrapConfig.databasePath);
  let closed = false;
  let settings: SettingsStore;
  let config: AppConfig;
  try {
    settings = new SettingsStore(
      db,
      () => closed,
      () => clock.now(),
    );
    config = loadConfig(env, {}, settings.snapshot());
  } catch (cause) {
    if (ownsDatabase) {
      try {
        db.close();
      } catch {
        // Preserve the initialization error.
      }
    }
    if (cause instanceof AppError) throw cause;
    throw new AppError('PERSISTENCE_UNAVAILABLE', 'Core services initialization failed', { cause });
  }
  return {
    config,
    clock,
    settings,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (!ownsDatabase) return;
      try {
        db.close();
      } catch (cause) {
        throw new AppError('PERSISTENCE_UNAVAILABLE', 'Database shutdown failed', { cause });
      }
    },
  };
}
