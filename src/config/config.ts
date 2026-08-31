import { z } from 'zod';

const environmentSchema = z.object({
  GAMING_DEALS_COUNTRY: z.string().regex(/^[A-Za-z]{2}$/).default('CO').transform((value) => value.toUpperCase()),
  GAMING_DEALS_COMPARISON_CURRENCY: z.string().regex(/^[A-Za-z]{3}$/).default('COP').transform((value) => value.toUpperCase()),
  GAMING_DEALS_DATABASE_PATH: z.string().min(1),
  GAMING_DEALS_PROVIDER_API_KEY: z.string().optional(),
});

export type AppConfig = {
  country: string;
  comparisonCurrency: string;
  databasePath: string;
  providerApiKey?: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error('Invalid configuration');
  }

  return {
    country: result.data.GAMING_DEALS_COUNTRY,
    comparisonCurrency: result.data.GAMING_DEALS_COMPARISON_CURRENCY,
    databasePath: result.data.GAMING_DEALS_DATABASE_PATH,
    ...(result.data.GAMING_DEALS_PROVIDER_API_KEY === undefined
      ? {}
      : { providerApiKey: result.data.GAMING_DEALS_PROVIDER_API_KEY }),
  };
}
