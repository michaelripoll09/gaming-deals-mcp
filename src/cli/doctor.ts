import { loadConfig } from '../config/config.js';
import { normalizedProviderSyncSchema, providerCapabilitySchema } from '../domain/providers/contracts.js';
import { PublicError, toPublicError } from '../errors/public-error.js';
import { openDatabase, type OpenDatabase } from '../persistence/sqlite/database.js';
import { DeterministicDealProvider } from '../providers/deterministic/deterministic-provider.js';

export async function runDoctor(input: {
  environment: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
}): Promise<'healthy' | 'unhealthy'> {
  const config = parseConfiguration(input.environment);
  if (config === undefined) {
    input.stdout('configuration: unhealthy (invalid_configuration)');
    return 'unhealthy';
  }
  input.stdout('configuration: healthy');

  let opened: OpenDatabase | undefined;
  try {
    opened = openStorage(config.databasePath);
  } catch (error) {
    return reportFailure(input.stdout, 'sqlite', error);
  }

  try {
    try {
      readMigrationMetadata(opened);
    } catch (error) {
      return reportFailure(input.stdout, 'migrations', error);
    }
    input.stdout('migrations: readable');

    try {
      probeStorage(opened);
    } catch (error) {
      return reportFailure(input.stdout, 'sqlite', error);
    }
    input.stdout('sqlite: writable');
  } finally {
    opened.close();
  }

  try {
    await checkDeterministicProvider({
      country: config.country,
      comparisonCurrency: config.comparisonCurrency,
    });
  } catch (error) {
    return reportFailure(input.stdout, 'deterministic_provider', error);
  }
  input.stdout('deterministic_provider: healthy');

  return 'healthy';
}

function parseConfiguration(environment: NodeJS.ProcessEnv) {
  try {
    return loadConfig(environment);
  } catch {
    return undefined;
  }
}

function openStorage(databasePath: string): OpenDatabase {
  try {
    return openDatabase(databasePath);
  } catch (error) {
    throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
  }
}

function readMigrationMetadata(opened: OpenDatabase): void {
  try {
    opened.database.prepare(
      'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version',
    ).all();
  } catch (error) {
    throw new PublicError('persistence_failure', 'Persistent storage metadata is unavailable', error);
  }
}

function probeStorage(opened: OpenDatabase): void {
  let transactionOpen = false;

  try {
    opened.database.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    opened.database.exec('CREATE TEMP TABLE doctor_probe (value TEXT NOT NULL)');
    opened.database.prepare('INSERT INTO doctor_probe (value) VALUES (?)').run('probe');
    const row = opened.database.prepare('SELECT value FROM doctor_probe').get() as { value?: unknown } | undefined;
    if (row?.value !== 'probe') {
      throw new Error('Doctor storage read probe failed');
    }
    opened.database.prepare('DELETE FROM doctor_probe').run();
    opened.database.exec('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        opened.database.exec('ROLLBACK');
      } catch {
        // The diagnostic must preserve the original bounded failure.
      }
    }
    throw new PublicError('persistence_failure', 'Persistent storage is unavailable', error);
  }
}

async function checkDeterministicProvider(input: {
  country: string;
  comparisonCurrency: string;
}): Promise<void> {
  try {
    const provider = new DeterministicDealProvider();
    if (!providerCapabilitySchema.safeParse(provider.capability).success) {
      throw new Error('Doctor provider capability is invalid');
    }

    const syncResult = await provider.sync({
      country: input.country,
      comparisonCurrency: input.comparisonCurrency,
      now: '1970-01-01T00:00:00.000Z',
    });
    if (!normalizedProviderSyncSchema.safeParse(syncResult).success) {
      throw new Error('Doctor provider sync result is invalid');
    }
  } catch (error) {
    throw new PublicError('provider_data_invalid', 'Deterministic provider diagnostics failed', error);
  }
}

function reportFailure(
  stdout: (line: string) => void,
  check: 'sqlite' | 'migrations' | 'deterministic_provider',
  error: unknown,
): 'unhealthy' {
  stdout(`${check}: unhealthy (${toPublicError(error).code})`);
  return 'unhealthy';
}