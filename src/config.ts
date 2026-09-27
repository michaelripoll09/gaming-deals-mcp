import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from './errors.js';

const preferenceSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1),
});

export interface AppConfig {
  readonly databasePath: string;
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
}

export type ConfigOverrides = Partial<z.infer<typeof preferenceSchema>>;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ConfigOverrides = {},
  persisted: ConfigOverrides = {},
): AppConfig {
  const merged = {
    country: 'US',
    currency: 'USD',
    timezone: 'UTC',
    ...persisted,
    ...overrides,
  };
  const parsed = preferenceSchema.safeParse(merged);
  if (
    !parsed.success ||
    !isTimeZone(parsed.data.timezone) ||
    !Intl.supportedValuesOf('currency').includes(parsed.data.currency)
  ) {
    throw new AppError('CONFIG_INVALID', 'Configuration is invalid');
  }
  const databasePath = env['DATABASE_PATH'] ?? '.gaming-deals/gaming-deals.sqlite';
  const config = {
    ...parsed.data,
    databasePath: databasePath === ':memory:' ? databasePath : resolve(databasePath),
  } as AppConfig;
  return Object.freeze(config);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
