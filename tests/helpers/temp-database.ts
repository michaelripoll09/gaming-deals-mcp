import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function createTemporaryDatabasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'gaming-deals-mcp-')), 'deals.sqlite');
}
