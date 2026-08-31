import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Application } from '../composition/root.js';
import { wishlistEntrySchema } from '../domain/wishlist/types.js';
import { runTool } from './tool-results.js';

const productVariantInputSchema = z.object({
  productVariantId: z.string().uuid(),
}).strict();

const wishlistCreateInputSchema = wishlistEntrySchema.pick({
  productVariantId: true,
  priority: true,
  targetPrice: true,
  notes: true,
}).extend({
  now: z.string().datetime(),
}).strict();

const localReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const localMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export function createMcpServer(application: Application): McpServer {
  const server = new McpServer({ name: 'gaming-deals-mcp', version: '0.1.0' });

  server.registerTool('catalog_search', {
    description: 'Searches the canonical gaming catalog.',
    inputSchema: z.object({ query: z.string().trim().min(1) }).strict(),
    annotations: localReadOnlyAnnotations,
  }, ({ query }) => runTool(() => application.searchCatalog(query)));

  server.registerTool('provider_sync_deterministic', {
    description: 'Synchronizes the deterministic local deal provider.',
    inputSchema: z.object({ observedAt: z.string().datetime() }).strict(),
    annotations: { ...localMutationAnnotations, idempotentHint: true },
  }, ({ observedAt }) => runTool(() => application.syncDeterministicProvider(observedAt)));

  server.registerTool('deal_compare_product', {
    description: 'Compares verified offers for a product variant.',
    inputSchema: productVariantInputSchema,
    annotations: localReadOnlyAnnotations,
  }, ({ productVariantId }) => runTool(() => application.compareProductVariant(productVariantId)));

  server.registerTool('deal_get_best_offer', {
    description: 'Gets the best eligible offer for a product variant.',
    inputSchema: productVariantInputSchema,
    annotations: localReadOnlyAnnotations,
  }, ({ productVariantId }) => runTool(() => application.compareProductVariant(productVariantId)));

  server.registerTool('deal_get_price_history', {
    description: 'Gets immutable price observations for a product variant.',
    inputSchema: productVariantInputSchema,
    annotations: localReadOnlyAnnotations,
  }, ({ productVariantId }) => runTool(() => application.listPriceHistory(productVariantId)));

  server.registerTool('wishlist_create', {
    description: 'Creates a local wishlist entry.',
    inputSchema: wishlistCreateInputSchema,
    annotations: localMutationAnnotations,
  }, (input) => runTool(() => application.createWishlistEntry(input)));

  server.registerTool('wishlist_list', {
    description: 'Lists local wishlist entries.',
    inputSchema: z.object({}).strict(),
    annotations: localReadOnlyAnnotations,
  }, () => runTool(() => application.listWishlistEntries()));

  server.registerTool('wishlist_update', {
    description: 'Updates an existing local wishlist entry.',
    inputSchema: wishlistEntrySchema,
    annotations: { ...localMutationAnnotations, idempotentHint: true },
  }, (entry) => runTool(() => application.updateWishlistEntry(entry)));

  server.registerTool('wishlist_remove', {
    description: 'Removes a local wishlist entry.',
    inputSchema: z.object({ wishlistEntryId: z.string().uuid() }).strict(),
    annotations: { ...localMutationAnnotations, destructiveHint: true, idempotentHint: true },
  }, ({ wishlistEntryId }) => runTool(() => application.removeWishlistEntry(wishlistEntryId)));

  return server;
}
