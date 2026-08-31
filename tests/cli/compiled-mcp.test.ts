import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const directories: string[] = [];

beforeAll(async () => {
  const build = await runBuild();
  expect(build).toMatchObject({ code: 0, signal: null });
});

afterAll(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('compiled MCP CLI', () => {
  test('serves stdio, exits cleanly after EOF, and releases the temporary database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gaming-deals-compiled-mcp-'));
    directories.push(directory);
    const databasePath = join(directory, 'deals.sqlite');
    const child = spawn(process.execPath, [resolve('dist/cli/main.js'), 'mcp'], {
      cwd: process.cwd(),
      env: { ...process.env, GAMING_DEALS_DATABASE_PATH: databasePath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }));

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'compiled-harness', version: '1.0.0' },
      },
    })}\n`);
    await waitFor(() => stdout.includes('"id":1') && stdout.includes('"protocolVersion"'));
    child.stdin.end();

    expect(await exited).toEqual({ code: 0, signal: null });
    expect(stderr).toBe('');
    expect(stdout).not.toContain(databasePath);
    expect(stdout).not.toContain('secret-value');
    expect(JSON.parse(stdout.trim())).toMatchObject({ jsonrpc: '2.0', id: 1 });

    expect(() => rmSync(directory, { force: true, recursive: true })).not.toThrow();
    directories.splice(directories.indexOf(directory), 1);
  });
});

function runBuild(): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  return process.platform === 'win32' ? run('pnpm.cmd build', []) : run('pnpm', ['build']);
}

function run(command: string, args: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  return once(child, 'exit').then(([code, signal]) => ({ code, signal, stderr }));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error('Timed out waiting for compiled MCP initialize response');
}
