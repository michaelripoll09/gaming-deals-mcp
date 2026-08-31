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
  test('closes each owned resource once when stdin ends while connection is pending', async () => {
    const runtime = createRuntime({ pendingConnect: true });
    const started = startMcp(doctorEnvironment(), runtime.dependencies);

    runtime.stdin.emit('end');
    runtime.resolveConnect();
    await started;

    expectCleaned(runtime, { applicationCloseCalls: 1, serverCloseCalls: 1 });
  });

  test.each(['SIGINT', 'SIGTERM'])('closes each owned resource once when %s arrives after connection', async (signal) => {
    const runtime = createRuntime({ pendingConnect: false });
    await startMcp(doctorEnvironment(), runtime.dependencies);

    runtime.signals.emit(signal);
    await waitFor(() => runtime.state.applicationCloseCalls === 1 && runtime.state.serverCloseCalls === 1);

    expectCleaned(runtime, { applicationCloseCalls: 1, serverCloseCalls: 1 });
  });

  test('closes the application once when the connected server closes', async () => {
    const runtime = createRuntime({ pendingConnect: false });
    await startMcp(doctorEnvironment(), runtime.dependencies);

    await runtime.closeServer();
    await waitFor(() => runtime.state.applicationCloseCalls === 1);

    expectCleaned(runtime, { applicationCloseCalls: 1, serverCloseCalls: 1 });
  });

  test('completes overlapping EOF, signal, and server-close cleanup without duplicate closes', async () => {
    const runtime = createRuntime({ pendingConnect: false });
    await startMcp(doctorEnvironment(), runtime.dependencies);

    const serverClose = runtime.closeServer();
    runtime.stdin.emit('end');
    runtime.signals.emit('SIGINT');
    runtime.signals.emit('SIGTERM');
    await Promise.race([
      Promise.all([serverClose, waitFor(() => runtime.state.applicationCloseCalls === 1)]),
      timeout(),
    ]);

    expectCleaned(runtime, { applicationCloseCalls: 1, serverCloseCalls: 1 });
  });

  test('closes application once and removes lifecycle listeners after a connection error', async () => {
    const runtime = createRuntime({ connectError: new Error('raw connect error') });

    await expect(startMcp(doctorEnvironment(), runtime.dependencies)).rejects.toThrow('raw connect error');

    expectCleaned(runtime, { applicationCloseCalls: 1, serverCloseCalls: 0 });
  });
});

function doctorEnvironment(): NodeJS.ProcessEnv {
  return { GAMING_DEALS_DATABASE_PATH: ':memory:' };
}

function createRuntime(input: { pendingConnect: boolean; connectError?: Error }) {
  const stdin = new EventEmitter();
  const signals = new EventEmitter();
  const state = { applicationCloseCalls: 0, serverCloseCalls: 0 };
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
      state.serverCloseCalls += 1;
      server.server.onclose?.();
    },
    connect: async () => connection,
  };

  return {
    dependencies: {
      stdin,
      signals,
      createApplication: () => ({ close: () => { state.applicationCloseCalls += 1; } }),
      createMcpServer: () => server,
      createTransport: () => ({}),
    },
    resolveConnect,
    closeServer: server.close,
    signals,
    state,
    stdin,
  };
}

function expectCleaned(
  runtime: ReturnType<typeof createRuntime>,
  expected: { applicationCloseCalls: number; serverCloseCalls: number },
): void {
  expect(runtime.state).toEqual(expected);
  expect(runtime.stdin.listenerCount('end')).toBe(0);
  expect(runtime.signals.listenerCount('SIGINT')).toBe(0);
  expect(runtime.signals.listenerCount('SIGTERM')).toBe(0);
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

function timeout(): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Lifecycle cleanup deadlocked')), 1000);
  });
}
