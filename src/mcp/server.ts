import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Application } from '../composition/root.js';
import { accessRecordSchema } from '../domain/access/types.js';
import { wishlistEntrySchema } from '../domain/wishlist/types.js';
import { invalidInputResult, runTool } from './tool-results.js';

const productVariantInputSchema = safeInputSchema({
  productVariantId: z.string().uuid(),
});

const wishlistCreateInputSchema = safeInputSchema({
  productVariantId: wishlistEntrySchema.shape.productVariantId,
  priority: wishlistEntrySchema.shape.priority,
  targetPrice: wishlistEntrySchema.shape.targetPrice,
  notes: wishlistEntrySchema.shape.notes,
  now: z.string().datetime(),
});

const catalogSearchInputSchema = safeInputSchema({ query: z.string().trim().min(1) });
const providerSyncInputSchema = safeInputSchema({ observedAt: z.string().datetime() });
const wishlistListInputSchema = safeInputSchema({});
const wishlistUpdateInputSchema = safeInputSchema(wishlistEntrySchema.shape);
const wishlistRemoveInputSchema = safeInputSchema({ wishlistEntryId: z.string().uuid() });
const accessCreateInputSchema = safeInputSchema({
  productVariantId: accessRecordSchema.shape.productVariantId,
  state: accessRecordSchema.shape.state,
  provenance: accessRecordSchema.shape.provenance,
  activeFrom: accessRecordSchema.shape.activeFrom.optional().default(null),
  activeUntil: accessRecordSchema.shape.activeUntil.optional().default(null),
  now: accessRecordSchema.shape.createdAt,
});
const accessListInputSchema = safeInputSchema({
  productVariantId: accessRecordSchema.shape.productVariantId.optional(),
});
const accessUpdateInputSchema = safeInputSchema(accessRecordSchema.shape);
const accessRemoveInputSchema = safeInputSchema({ accessRecordId: z.string().uuid() });
const whatShouldIBuyInputSchema = safeInputSchema({});

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
    inputSchema: catalogSearchInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, ({ query }) => application.searchCatalog(query)));

  server.registerTool('provider_sync_deterministic', {
    description: 'Synchronizes the deterministic local deal provider.',
    inputSchema: providerSyncInputSchema,
    annotations: { ...localMutationAnnotations, idempotentHint: true },
  }, (input) => runValidatedTool(input, ({ observedAt }) => application.syncDeterministicProvider(observedAt)));

  server.registerTool('deal_compare_product', {
    description: 'Compares verified offers for a product variant.',
    inputSchema: productVariantInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, ({ productVariantId }) => application.compareProductVariant(productVariantId)));

  server.registerTool('deal_get_best_offer', {
    description: 'Gets the best eligible offer for a product variant.',
    inputSchema: productVariantInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, ({ productVariantId }) => application.compareProductVariant(productVariantId)));

  server.registerTool('deal_get_price_history', {
    description: 'Gets immutable price observations for a product variant.',
    inputSchema: productVariantInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, ({ productVariantId }) => application.listPriceHistory(productVariantId)));

  server.registerTool('wishlist_create', {
    description: 'Creates a local wishlist entry.',
    inputSchema: wishlistCreateInputSchema,
    annotations: localMutationAnnotations,
  }, (input) => runValidatedTool(input, (entry) => application.createWishlistEntry(entry)));

  server.registerTool('wishlist_list', {
    description: 'Lists local wishlist entries.',
    inputSchema: wishlistListInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, () => application.listWishlistEntries()));

  server.registerTool('wishlist_update', {
    description: 'Updates an existing local wishlist entry.',
    inputSchema: wishlistUpdateInputSchema,
    annotations: { ...localMutationAnnotations, idempotentHint: true },
  }, (input) => runValidatedTool(input, (entry) => application.updateWishlistEntry(entry)));

  server.registerTool('wishlist_remove', {
    description: 'Removes a local wishlist entry.',
    inputSchema: wishlistRemoveInputSchema,
    annotations: { ...localMutationAnnotations, destructiveHint: true, idempotentHint: true },
  }, (input) => runValidatedTool(input, ({ wishlistEntryId }) => application.removeWishlistEntry(wishlistEntryId)));

  server.registerTool('access_create', {
    description: 'Creates a manual local access record.',
    inputSchema: accessCreateInputSchema,
    annotations: localMutationAnnotations,
  }, (input) => runValidatedTool(input, (entry) => application.createAccessRecord(entry)));

  server.registerTool('access_list', {
    description: 'Lists local access records.',
    inputSchema: accessListInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, (filter) => application.listAccessRecords(filter)));

  server.registerTool('access_update', {
    description: 'Updates an existing local access record.',
    inputSchema: accessUpdateInputSchema,
    annotations: { ...localMutationAnnotations, idempotentHint: true },
  }, (input) => runValidatedTool(input, (record) => application.updateAccessRecord(record)));

  server.registerTool('access_remove', {
    description: 'Removes a local access record.',
    inputSchema: accessRemoveInputSchema,
    annotations: { ...localMutationAnnotations, destructiveHint: true, idempotentHint: true },
  }, (input) => runValidatedTool(input, ({ accessRecordId }) => application.removeAccessRecord(accessRecordId)));

  server.registerTool('what_should_i_buy', {
    description: 'Recommends wishlist products worth buying now.',
    inputSchema: whatShouldIBuyInputSchema,
    annotations: localReadOnlyAnnotations,
  }, (input) => runValidatedTool(input, () => application.whatShouldIBuy()));

  return server;
}

const invalidInputMarker = Symbol('invalid-input');

function safeInputSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  // Preserve the strict input schema advertised to MCP clients while routing malformed values to this adapter.
  const protectedShape = Object.fromEntries(Object.entries(shape).map(([name, schema]) => [
    name,
    (schema as unknown as z.ZodType).catch(() => invalidInputMarker as never),
  ])) as unknown as Shape;

  return z.object(protectedShape)
    .catchall(z.never().catch(() => invalidInputMarker as never))
    .meta({ additionalProperties: false });
}

function runValidatedTool<T extends object>(
  input: T,
  operation: (input: T) => Promise<unknown>,
) {
  return containsInvalidInput(input) ? Promise.resolve(invalidInputResult()) : runTool(() => operation(input));
}

function containsInvalidInput(input: object): boolean {
  return Object.values(input).some((value) => value === invalidInputMarker);
}
