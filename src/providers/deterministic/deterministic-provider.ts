import {
  normalizedProviderSyncSchema,
  providerCapabilitySchema,
  type DealProvider,
} from '../../domain/providers/contracts.js';
import { deterministicSyncFixture } from './fixtures.js';

export class DeterministicDealProvider implements DealProvider {
  readonly capability: DealProvider['capability'] = providerCapabilitySchema.parse({
    providerId: 'deterministic',
    displayName: 'Deterministic Fixture Provider',
    retailerClass: 'authorized_store',
    sourceConfidence: 'high',
    supportedCountries: ['CO'],
    authentication: 'none',
    enabledByDefault: true,
  });

  async sync(_input: { country: string; comparisonCurrency: string; now: string }): Promise<unknown> {
    return normalizedProviderSyncSchema.parse(deterministicSyncFixture);
  }
}
