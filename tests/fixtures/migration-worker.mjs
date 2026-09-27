import process from 'node:process';
import { pathToFileURL } from 'node:url';

const [databasePath, implementationPath] = process.argv.slice(2);
if (!databasePath || !implementationPath || !process.send) {
  throw new Error('Migration worker arguments are invalid');
}

process.send({ ready: true });
function safeErrorDetails(error) {
  const details = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const name = current instanceof Error ? current.constructor.name : typeof current;
    const rawCode = current && typeof current === 'object' ? current.code : undefined;
    const code = typeof rawCode === 'string' && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : undefined;
    details.push({ type: name, ...(code ? { code } : {}) });
    current = current && typeof current === 'object' ? current.cause : undefined;
  }
  return details;
}

process.once('message', async (message) => {
  if (message !== 'start') return;
  try {
    const { openDatabase } = await import(pathToFileURL(implementationPath).href);
    const database = openDatabase(databasePath);
    const rows = database.prepare('SELECT version, name, checksum FROM schema_migrations').all();
    database.close();
    process.send?.({ result: rows });
    process.disconnect?.();
  } catch (error) {
    process.send?.({ error: safeErrorDetails(error) });
    process.disconnect?.();
    process.exitCode = 1;
  }
});
