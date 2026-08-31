import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations.js';

export interface OpenDatabase {
  readonly database: DatabaseSync;
  close(): void;
}

export function openDatabase(databasePath: string): OpenDatabase {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA journal_mode = WAL');
    applyMigrations(database);

    return {
      database,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
