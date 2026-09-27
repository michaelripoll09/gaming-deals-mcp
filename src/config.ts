import { z } from 'zod';
import { AppError } from './errors.js';

const preferenceSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timeZone: z.string().min(1),
});

export interface AppConfig {
  readonly databasePath: string;
  readonly country: string;
  readonly currency: string;
  readonly timeZone: string;
  readonly secrets: Readonly<{ itadApiKey?: string }>;
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
    timeZone: 'UTC',
    ...persisted,
    ...overrides,
  };
  const parsed = preferenceSchema.safeParse(merged);
  if (
    !parsed.success ||
    !isTimeZone(parsed.data.timeZone) ||
    !Intl.supportedValuesOf('currency').includes(parsed.data.currency)
  ) {
    throw new AppError('CONFIG_INVALID', 'Configuration is invalid');
  }
  const config = {
    ...parsed.data,
    databasePath: env['DATABASE_PATH'] ?? '.gaming-deals/gaming-deals.sqlite',
  } as AppConfig;
  Object.defineProperty(config, 'secrets', {
    value: env['ITAD_API_KEY'] === undefined ? {} : { itadApiKey: env['ITAD_API_KEY'] },
    enumerable: false,
    writable: false,
  });
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
