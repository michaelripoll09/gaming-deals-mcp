import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import type { Application } from '../../src/composition/root.js';
import { createApplication } from '../../src/composition/root.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

const productVariantId = '10293847-5647-4a3b-8c2d-1e0f9a8b7c6d';
const secondProductVariantId = 'fedcba98-7654-4b3a-9210-0fedcba98765';
const unknownProductVariantId = '00000000-0000-4000-8000-000000000099';
const now = '2026-08-30T00:00:00.000Z';
const later = '2026-08-31T00:00:00.000Z';

describe('Gaming Deals MCP server', () => {
  test('discovers exactly the supported tools with accurate safety annotations', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'access_create',
        'access_list',
        'access_remove',
        'access_update',
        'catalog_search',
        'deal_compare_product',
        'deal_get_best_offer',
        'deal_get_price_history',
        'provider_sync_deterministic',
        'what_should_i_buy',
        'wishlist_create',
        'wishlist_list',
        'wishlist_remove',
        'wishlist_update',
      ]);
      expect(toolByName(tools.tools, 'catalog_search').annotations).toMatchObject({
        readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'wishlist_create').annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'wishlist_remove').annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'access_remove').annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'access_create').annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'access_list').annotations).toMatchObject({
        readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'access_update').annotations).toMatchObject({
        readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'what_should_i_buy').annotations).toMatchObject({
        readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      });
      expect(toolByName(tools.tools, 'what_should_i_buy').inputSchema).toMatchObject({
        type: 'object', additionalProperties: false,
      });
      expect(toolByName(tools.tools, 'deal_get_best_offer').inputSchema).toMatchObject({
        type: 'object',
        required: ['productVariantId'],
        additionalProperties: false,
        properties: { productVariantId: { type: 'string', format: 'uuid' } },
      });
    });
  });

  test('syncs deterministic data and exposes catalog, comparison, best-offer, and history results', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      const sync = await client.callTool({
        name: 'provider_sync_deterministic', arguments: { observedAt: '2026-08-30T00:00:00.000Z' },
      });
      expectSuccess(sync, { catalogCount: 2, listingCount: 3, offerCount: 3, observationCount: 3 });

      const catalog = await client.callTool({ name: 'catalog_search', arguments: { query: 'cobalt' } });
      expectSuccess(catalog, [expect.objectContaining({ id: productVariantId })]);

      const comparison = await client.callTool({
        name: 'deal_compare_product', arguments: { productVariantId },
      });
      expectSuccess(comparison, expect.objectContaining({ selected: expect.objectContaining({
        offer: expect.objectContaining({ id: '13579bdf-2468-4ace-8bdf-02468ace1357' }),
      }) }));

      const bestOffer = await client.callTool({
        name: 'deal_get_best_offer', arguments: { productVariantId },
      });
      expectSuccess(bestOffer, expect.objectContaining({ selected: expect.objectContaining({
        offer: expect.objectContaining({ id: '13579bdf-2468-4ace-8bdf-02468ace1357' }),
      }) }));

      const history = await client.callTool({
        name: 'deal_get_price_history', arguments: { productVariantId },
      });
      expectSuccess(history, [expect.objectContaining({
        offerId: '13579bdf-2468-4ace-8bdf-02468ace1357',
        observedAt: '2026-08-30T00:00:00.000Z',
      })]);
    });
  });

  test('creates, lists, updates, and removes wishlist entries', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      expectSuccess(await client.callTool({
        name: 'provider_sync_deterministic', arguments: { observedAt: '2026-08-30T00:00:00.000Z' },
      }), { catalogCount: 2, listingCount: 3, offerCount: 3, observationCount: 3 });

      const created = await client.callTool({
        name: 'wishlist_create',
        arguments: {
          productVariantId,
          priority: 2,
          targetPrice: { amountMinor: 3_500_000, currency: 'COP' },
          notes: 'Watch for a sale',
          now: '2026-08-30T00:00:00.000Z',
        },
      });
      const createdEntry = expectSuccess(created, expect.objectContaining({
        productVariantId, priority: 2, notes: 'Watch for a sale',
      }));

      const listed = await client.callTool({ name: 'wishlist_list', arguments: {} });
      expectSuccess(listed, [createdEntry]);

      const updated = await client.callTool({
        name: 'wishlist_update',
        arguments: { ...createdEntry, priority: 1, notes: null, updatedAt: '2026-08-31T00:00:00.000Z' },
      });
      const updatedEntry = expectSuccess(updated, expect.objectContaining({ priority: 1, notes: null }));

      const removed = await client.callTool({ name: 'wishlist_remove', arguments: { wishlistEntryId: updatedEntry.id } });
      expectSuccess(removed, true);
      expectSuccess(await client.callTool({ name: 'wishlist_list', arguments: {} }), []);
    });
  });

  test('normalizes malformed MCP input into the safe public error envelope', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      const result = await client.callTool({
        name: 'deal_get_best_offer',
        arguments: { productVariantId: 'C:\\Users\\michael\\secret-value' },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: 'internal_error', message: 'An unexpected error occurred' });
      expect(result.content).toEqual([{
        type: 'text', text: '{"code":"internal_error","message":"An unexpected error occurred"}',
      }]);
      expect(JSON.stringify(result)).not.toContain('C:\\Users\\');
      expect(JSON.stringify(result)).not.toContain('secret-value');
      expect(JSON.stringify(result)).not.toContain('Input validation error');
      expect(JSON.stringify(result)).not.toContain('Invalid UUID');

      const unexpectedProperty = await client.callTool({
        name: 'deal_get_best_offer',
        arguments: { productVariantId, rawInput: 'C:\\Users\\michael\\secret-value' },
      });
      expect(unexpectedProperty.isError).toBe(true);
      expect(unexpectedProperty.structuredContent).toEqual({
        code: 'internal_error', message: 'An unexpected error occurred',
      });
      expect(unexpectedProperty.content).toEqual([{
        type: 'text', text: '{"code":"internal_error","message":"An unexpected error occurred"}',
      }]);
      expect(JSON.stringify(unexpectedProperty)).not.toContain('C:\\Users\\');
      expect(JSON.stringify(unexpectedProperty)).not.toContain('secret-value');
    });
  });

  test('creates, filters, updates, removes, and persists manual access records for every state', async () => {
    const temporary = createTemporaryDatabase();
    const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });

    try {
      let createdOwned: Record<string, unknown>;
      await withApplicationClient(application, async (client) => {
        expectSuccess(await client.callTool({
          name: 'provider_sync_deterministic', arguments: { observedAt: now },
        }), { catalogCount: 2, listingCount: 3, offerCount: 3, observationCount: 3 });

        createdOwned = expectSuccess(await client.callTool({
          name: 'access_create', arguments: {
            productVariantId, state: 'owned', provenance: 'manual', now,
          },
        }), expect.objectContaining({
          productVariantId, state: 'owned', provenance: 'manual', activeFrom: null, activeUntil: null,
        }));
        const subscription = expectSuccess(await client.callTool({
          name: 'access_create', arguments: {
            productVariantId, state: 'subscription_access', provenance: 'manual', now,
            activeFrom: now, activeUntil: '2026-09-30T00:00:00.000Z',
          },
        }), expect.objectContaining({ state: 'subscription_access' }));
        const loan = expectSuccess(await client.callTool({
          name: 'access_create', arguments: {
            productVariantId, state: 'loan', provenance: 'manual', now,
          },
        }), expect.objectContaining({ state: 'loan', activeFrom: null, activeUntil: null }));

        const filtered = expectSuccess(await client.callTool({
          name: 'access_list', arguments: { productVariantId },
        }), expect.arrayContaining([createdOwned, subscription, loan]));
        expect(filtered).toHaveLength(3);
        const allRecords = expectSuccess(await client.callTool({ name: 'access_list', arguments: {} }),
          expect.arrayContaining([createdOwned, subscription, loan]));
        expect(allRecords).toHaveLength(3);

        const updated = expectSuccess(await client.callTool({
          name: 'access_update', arguments: { ...createdOwned, state: 'loan', updatedAt: later },
        }), expect.objectContaining({ state: 'loan', updatedAt: later }));
        expectSuccess(await client.callTool({
          name: 'access_update', arguments: {
            ...updated, id: '00000000-0000-4000-8000-000000000098', updatedAt: '2026-09-01T00:00:00.000Z',
          },
        }), null);
        expectSuccess(await client.callTool({
          name: 'access_remove', arguments: { accessRecordId: '00000000-0000-4000-8000-000000000098' },
        }), false);
        expectSuccess(await client.callTool({
          name: 'access_remove', arguments: { accessRecordId: updated.id },
        }), true);
        expectSuccess(await client.callTool({
          name: 'access_remove', arguments: { accessRecordId: updated.id },
        }), false);
      });

      application.close();
      const reopened = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });
      try {
        await withApplicationClient(reopened, async (client) => {
          const persisted = expectSuccess(await client.callTool({ name: 'access_list', arguments: { productVariantId } }), expect.arrayContaining([
            expect.objectContaining({ state: 'subscription_access' }),
            expect.objectContaining({ state: 'loan' }),
          ]));
          expect(persisted).toHaveLength(2);
        });
      } finally {
        reopened.close();
      }
    } finally {
      try { application.close(); } catch { /* already closed */ }
      temporary.cleanup();
    }
  });

  test('keeps access input validation and public errors strict and safe', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      await expectSafeInputError(client, 'access_create', {
        productVariantId: 'not-a-uuid', state: 'owned', provenance: 'manual', now,
      });
      await expectSafeInputError(client, 'access_create', {
        productVariantId, state: 'owned', provenance: 'provider', now,
      });
      await expectSafeInputError(client, 'access_create', {
        productVariantId, state: 'loan', provenance: 'manual', now,
        activeFrom: 'not-a-timestamp', activeUntil: '2026-09-30T00:00:00.000Z', rawProviderPayload: 'secret-value',
      });
      await expectSafeInputError(client, 'access_update', {
        id: 'not-a-uuid', productVariantId, state: 'loan', provenance: 'manual',
        activeFrom: now, activeUntil: now, createdAt: now, updatedAt: now,
      });
      await expectSafeInputError(client, 'access_list', { productVariantId: 'not-a-uuid' });
      await expectSafeInputError(client, 'access_remove', { accessRecordId: 'not-a-uuid' });
      await expectSafeInputError(client, 'what_should_i_buy', { policy: 'C:\\Users\\michael\\secret-value' });

      const missingProduct = await client.callTool({
        name: 'access_create', arguments: {
          productVariantId: unknownProductVariantId, state: 'owned', provenance: 'manual', now,
        },
      });
      expect(missingProduct.structuredContent).toEqual({
        code: 'product_not_found', message: 'Product variant was not found',
      });
      expect(JSON.stringify(missingProduct)).not.toMatch(/(?:SELECT|INSERT|UPDATE|DELETE|C:\\Users|secret-value)/i);
    });
  });

  test('recommends wishlist candidates with temporary access and excludes owned products', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      expectSuccess(await client.callTool({
        name: 'provider_sync_deterministic', arguments: { observedAt: now },
      }), { catalogCount: 2, listingCount: 3, offerCount: 3, observationCount: 3 });
      for (const candidate of [productVariantId, secondProductVariantId]) {
        expectSuccess(await client.callTool({
          name: 'wishlist_create', arguments: {
            productVariantId: candidate, priority: 1, targetPrice: null, notes: null, now,
          },
        }), expect.objectContaining({ productVariantId: candidate }));
      }
      expectSuccess(await client.callTool({
        name: 'access_create', arguments: {
          productVariantId, state: 'subscription_access', provenance: 'manual', now,
        },
      }), expect.objectContaining({ state: 'subscription_access' }));
      expectSuccess(await client.callTool({
        name: 'access_create', arguments: {
          productVariantId: secondProductVariantId, state: 'owned', provenance: 'manual', now,
        },
      }), expect.objectContaining({ state: 'owned' }));

      expectSuccess(await client.callTool({ name: 'what_should_i_buy', arguments: {} }), expect.objectContaining({
        recommendations: expect.arrayContaining([expect.objectContaining({
          productVariant: expect.objectContaining({ id: productVariantId }),
          access: expect.objectContaining({ kind: 'temporary_access' }),
        })]),
        exclusions: expect.arrayContaining([expect.objectContaining({
          blockers: ['Product is already owned'],
        })]),
      }));
    });
  });

  test('converts unexpected application errors into safe public error envelopes', async () => {
    const fixture = createApplicationForTest();
    fixture.application.searchCatalog = async () => {
      throw new Error('secret-value at C:\\Users\\michael\\deals.sqlite');
    };

    await withClient(fixture, async (client) => {
      const result = await client.callTool({ name: 'catalog_search', arguments: { query: 'cobalt' } });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: 'internal_error', message: 'An unexpected error occurred' });
      expect(JSON.stringify(result)).not.toContain('secret-value');
      expect(JSON.stringify(result)).not.toContain('C:\\Users\\');
    });
  });
});

function createApplicationForTest(): { application: Application; cleanup: () => void } {
  const temporary = createTemporaryDatabase();
  const application = createApplication({ databasePath: temporary.path, country: 'CO', comparisonCurrency: 'COP' });
  return { application, cleanup: () => { application.close(); temporary.cleanup(); } };
}

async function withClient(
  fixture: { application: Application; cleanup: () => void },
  testCase: (client: Client) => Promise<void>,
): Promise<void> {
  try {
    await withApplicationClient(fixture.application, testCase);
  } finally {
    fixture.cleanup();
  }
}

async function withApplicationClient(
  application: Application,
  testCase: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createMcpServer(application);
  const client = new Client({ name: 'gaming-deals-test', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await testCase(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function expectSafeInputError(client: Client, name: string, arguments_: Record<string, unknown>): Promise<void> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual({ code: 'internal_error', message: 'An unexpected error occurred' });
  expect(JSON.stringify(result)).not.toMatch(/(?:SELECT|INSERT|UPDATE|DELETE|C:\\Users|secret-value|rawProviderPayload)/i);
}

function toolByName(tools: Array<{ name: string }>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`Expected tool ${name} to be registered`);
  }
  return tool;
}

function expectSuccess<T>(result: { isError?: boolean; structuredContent?: unknown; content: unknown[] }, expected: T): T {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ result: expected });
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  return (result.structuredContent as { result: T }).result;
}
