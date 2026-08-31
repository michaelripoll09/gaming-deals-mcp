import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test } from 'vitest';
import { runCli, startMcp } from '../../src/cli/main.js';
import { createTemporaryDatabase, type TemporaryDatabase } from '../helpers/temp-database.js';

const databases: TemporaryDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.cleanup();
  }
});

describe('runCli', () => {
  test('prints bounded usage and exits two for an unknown command', async () => {
    const lines: string[] = [];

    const exitCode = await runCli(['unknown'], {}, (line) => lines.push(line));

    expect(exitCode).toBe(2);
    expect(lines).toEqual(['Usage: gaming-deals <doctor|mcp>']);
  });

  test('runs doctor and maps a healthy result to zero', async () => {
    const database = createTemporaryDatabase();
    databases.push(database);
    const lines: string[] = [];

    const exitCode = await runCli(['doctor'], {
      GAMING_DEALS_DATABASE_PATH: database.path,
    }, (line) => lines.push(line));

    expect(exitCode).toBe(0);
    expect(lines).toContain('configuration: healthy');
  });

  test('runs doctor and maps an unhealthy result to one', async () => {
    const lines: string[] = [];

    const exitCode = await runCli(['doctor'], {
      GAMING_DEALS_COMPARISON_CURRENCY: 'COPP',
    }, (line) => lines.push(line));

    expect(exitCode).toBe(1);
    expect(lines).toEqual(['configuration: unhealthy (invalid_configuration)']);
  });

  test('returns one without protocol output when controlled MCP startup fails', async () => {
    const lines: string[] = [];

    const exitCode = await runCli(['mcp'], doctorEnvironment(), (line) => lines.push(line), {
      startMcp: async () => {
        throw new Error('C:/Users/private/gaming-deals.sqlite secret-value raw connect error');
      },
    });

    expect(exitCode).toBe(1);
    expect(lines).toEqual([]);
  });
});

describe('startMcp lifecycle', () => {
  test('closes resources when stdin ends while connection is pending', async () => {
    const runtime = createRuntime({ pendingConnect: true });
    const started = startMcp(doctorEnvironment(), runtime.dependencies);

    runtime.stdin.emit('end');
    runtime.resolveConnect();
    await started;

    expect(runtime.state).toEqual({ applicationClosed: true, serverClosed: true });
    expect(runtime.stdin.listenerCount('end')).toBe(0);
    expect(runtime.signals.listenerCount('SIGINT')).toBe(0);
    expect(runtime.signals.listenerCount('SIGTERM')).toBe(0);
  });

  test('closes resources when SIGTERM arrives after connection', async () => {
    const runtime = createRuntime({ pendingConnect: false });
    await startMcp(doctorEnvironment(), runtime.dependencies);

    runtime.signals.emit('SIGTERM');
    await waitFor(() => runtime.state.applicationClosed && runtime.state.serverClosed);

    expect(runtime.state).toEqual({ applicationClosed: true, serverClosed: true });
    expect(runtime.stdin.listenerCount('end')).toBe(0);
    expect(runtime.signals.listenerCount('SIGINT')).toBe(0);
    expect(runtime.signals.listenerCount('SIGTERM')).toBe(0);
  });
  test('closes the application when the connected server closes', async () => {
    const runtime = createRuntime({ pendingConnect: false });
    await startMcp(doctorEnvironment(), runtime.dependencies);

    runtime.serverClosed();
    await waitFor(() => runtime.state.applicationClosed);

    expect(runtime.state).toEqual({ applicationClosed: true, serverClosed: true });
    expect(runtime.stdin.listenerCount('end')).toBe(0);
    expect(runtime.signals.listenerCount('SIGINT')).toBe(0);
    expect(runtime.signals.listenerCount('SIGTERM')).toBe(0);
  });

  test('closes application and removes lifecycle listeners after a connection error', async () => {
    const runtime = createRuntime({ connectError: new Error('raw connect error') });

    await expect(startMcp(doctorEnvironment(), runtime.dependencies)).rejects.toThrow('raw connect error');

    expect(runtime.state).toEqual({ applicationClosed: true, serverClosed: false });
    expect(runtime.stdin.listenerCount('end')).toBe(0);
    expect(runtime.signals.listenerCount('SIGINT')).toBe(0);
    expect(runtime.signals.listenerCount('SIGTERM')).toBe(0);
  });
});

function doctorEnvironment(): NodeJS.ProcessEnv {
  return { GAMING_DEALS_DATABASE_PATH: ':memory:' };
}

function createRuntime(input: { pendingConnect: boolean; connectError?: Error }) {
  const stdin = new EventEmitter();
  const signals = new EventEmitter();
  const state = { applicationClosed: false, serverClosed: false };
  let resolveConnect = () => undefined;
  const connection = new Promise<void>((resolve, reject) => {
    resolveConnect = resolve;
    if (input.connectError !== undefined) {
      reject(input.connectError);
    } else if (!input.pendingConnect) {
      resolve();
    }
  });
  const server = {
    server: { onclose: undefined as (() => void) | undefined },
    close: async () => {
      state.serverClosed = true;
      server.server.onclose?.();
    },
    connect: async () => connection,
  };

  return {
    dependencies: {
      stdin,
      signals,
      createApplication: () => ({ close: () => { state.applicationClosed = true; } }),
      createMcpServer: () => server,
      createTransport: () => ({}),
    },
    resolveConnect,
    serverClosed: () => {
      state.serverClosed = true;
      server.server.onclose?.();
    },
    signals,
    state,
    stdin,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Lifecycle did not finish');
}
