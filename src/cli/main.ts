import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApplication } from '../composition/root.js';
import { loadConfig } from '../config/config.js';
import { createMcpServer } from '../mcp/server.js';
import { runDoctor } from './doctor.js';

const usage = 'Usage: gaming-deals <doctor|mcp>';

export async function runCli(
  argv: string[],
  environment: NodeJS.ProcessEnv,
  stdout: (line: string) => void,
): Promise<number> {
  if (argv.length !== 1) {
    stdout(usage);
    return 2;
  }

  if (argv[0] === 'doctor') {
    return (await runDoctor({ environment, stdout })) === 'healthy' ? 0 : 1;
  }

  if (argv[0] === 'mcp') {
    try {
      await startMcp(environment);
      return 0;
    } catch {
      return 1;
    }
  }

  stdout(usage);
  return 2;
}

async function startMcp(environment: NodeJS.ProcessEnv): Promise<void> {
  const config = loadConfig(environment);
  const application = createApplication({
    databasePath: config.databasePath,
    country: config.country,
    comparisonCurrency: config.comparisonCurrency,
  });
  const server = createMcpServer(application);
  const transport = new StdioServerTransport();
  let connected = false;
  let closed = false;

  const cleanup = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);

    try {
      if (connected) {
        await server.close();
      }
    } finally {
      application.close();
    }
  };
  const onSignal = (): void => {
    void cleanup();
  };

  server.server.onclose = () => {
    void cleanup();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await server.connect(transport);
    connected = true;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli(process.argv.slice(2), process.env, (line) => process.stdout.write(`${line}\n`))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}