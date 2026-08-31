import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TemporaryDatabase {
  readonly path: string;
  cleanup(): void;
}

export function createTemporaryDatabase(): TemporaryDatabase {
  const directoryPath = mkdtempSync(join(tmpdir(), 'gaming-deals-mcp-'));

  return {
    path: join(directoryPath, 'deals.sqlite'),
    cleanup: () => {
      rmSync(directoryPath, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      });
    },
  };
}
