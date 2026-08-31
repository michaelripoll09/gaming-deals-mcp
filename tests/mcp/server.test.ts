import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import type { Application } from '../../src/composition/root.js';
import { createApplication } from '../../src/composition/root.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { createTemporaryDatabase } from '../helpers/temp-database.js';

const productVariantId = '10293847-5647-4a3b-8c2d-1e0f9a8b7c6d';

describe('Gaming Deals MCP server', () => {
  test('discovers exactly the supported tools with accurate safety annotations', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'catalog_search',
        'deal_compare_product',
        'deal_get_best_offer',
        'deal_get_price_history',
        'provider_sync_deterministic',
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

  test('rejects malformed inputs at the MCP boundary', async () => {
    await withClient(createApplicationForTest(), async (client) => {
      const result = await client.callTool({
        name: 'deal_get_best_offer', arguments: { productVariantId: 'not-a-uuid' },
      });

      expect(result.isError).toBe(true);
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
  const server = createMcpServer(fixture.application);
  const client = new Client({ name: 'gaming-deals-test', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await testCase(client);
  } finally {
    await client.close();
    await server.close();
    fixture.cleanup();
  }
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
