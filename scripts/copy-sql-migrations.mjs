import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repositoryRoot, 'src/persistence/sqlite/migrations');
const destination = resolve(repositoryRoot, 'dist/persistence/sqlite/migrations');

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
