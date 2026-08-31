import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApplication } from '../composition/root.js';
import { loadConfig } from '../config/config.js';
import { createMcpServer } from '../mcp/server.js';
import { runDoctor } from './doctor.js';

const usage = 'Usage: gaming-deals <doctor|mcp>';

type SignalSource = Pick<NodeJS.Process, 'off' | 'on'>;

export interface McpDependencies {
  createApplication?: typeof createApplication;
  createMcpServer?: typeof createMcpServer;
  createTransport?: () => StdioServerTransport;
  signals?: SignalSource;
  stdin?: NodeJS.ReadableStream;
}

export interface CliDependencies {
  runDoctor?: typeof runDoctor;
  startMcp?: (environment: NodeJS.ProcessEnv) => Promise<void>;
}

export async function runCli(
  argv: string[],
  environment: NodeJS.ProcessEnv,
  stdout: (line: string) => void,
  dependencies: CliDependencies = {},
): Promise<number> {
  if (argv.length !== 1) {
    stdout(usage);
    return 2;
  }

  if (argv[0] === 'doctor') {
    const doctor = dependencies.runDoctor ?? runDoctor;
    return (await doctor({ environment, stdout })) === 'healthy' ? 0 : 1;
  }

  if (argv[0] === 'mcp') {
    try {
      await (dependencies.startMcp ?? startMcp)(environment);
      return 0;
    } catch {
      return 1;
    }
  }

  stdout(usage);
  return 2;
}

export async function startMcp(
  environment: NodeJS.ProcessEnv,
  dependencies: McpDependencies = {},
): Promise<void> {
  const config = loadConfig(environment);
  const application = (dependencies.createApplication ?? createApplication)({
    databasePath: config.databasePath,
    country: config.country,
    comparisonCurrency: config.comparisonCurrency,
  });
  const server = (dependencies.createMcpServer ?? createMcpServer)(application);
  const transport = (dependencies.createTransport ?? (() => new StdioServerTransport()))();
  const stdin = dependencies.stdin ?? process.stdin;
  const signals = dependencies.signals ?? process;
  let connected = false;
  let serverClosed = false;
  let connection: Promise<void> | undefined;
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise === undefined) {
      cleanupPromise = (async () => {
        stdin.off('end', onEnd);
        signals.off('SIGINT', onSignal);
        signals.off('SIGTERM', onSignal);

        try {
          await connection?.catch(() => undefined);
          if (connected && !serverClosed) {
            await server.close();
          }
        } finally {
          application.close();
        }
      })();
    }
    return cleanupPromise;
  };
  const onEnd = (): void => {
    void cleanup();
  };
  const onSignal = (): void => {
    void cleanup();
  };

  server.server.onclose = () => {
    serverClosed = true;
    void cleanup();
  };
  stdin.once('end', onEnd);
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  connection = Promise.resolve()
    .then(() => server.connect(transport))
    .then(() => {
      connected = true;
    });

  try {
    await connection;
  } catch (error) {
    await cleanup();
    throw error;
  }

  await cleanupPromise;
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
