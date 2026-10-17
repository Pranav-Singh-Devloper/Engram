import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_DATABASE_URL } from '@engram/core';
import { testDb } from '@engram/core/testing';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, describe, expect, it } from 'vitest';

const pkg = path.resolve(import.meta.dirname, '..');
const tsx = path.join(pkg, 'node_modules', '.bin', 'tsx');
const entry = path.join(pkg, 'src', 'stdio.ts');
const slug = `stdio-${randomUUID().slice(0, 8)}`;
const db = testDb();

// No provider call happens in these tests; the key only has to be present.
const env: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  ENGRAM_NAMESPACE: slug,
  DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  GEMINI_API_KEY: 'unused-by-these-tests',
  GEMINI_API_KEY_FALLBACK: '',
};

afterAll(async () => {
  await db`delete from namespaces where slug = ${slug}`;
  await db.end();
});

describe('the stdio binary', () => {
  it('serves tools and stats to the SDK client', async () => {
    const client = new Client({ name: 'engram-stdio-test', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({ command: tsx, args: [entry], env, stderr: 'pipe' }),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    const stats = await client.readResource({ uri: 'engram://stats' });
    const [first] = stats.contents;
    expect(JSON.parse(first && 'text' in first ? first.text : '{}')).toMatchObject({
      namespace: slug,
    });
    await client.close();
  }, 30_000);

  it('writes nothing but JSON-RPC to stdout, and exits when stdin closes', async () => {
    const child = spawn(tsx, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const deadline = Date.now() + 20_000;
    while (!stdout.includes('"id":2') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));

    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    const messages = lines.map(
      (l) => JSON.parse(l) as { jsonrpc: string; id?: number; result?: { tools?: unknown[] } },
    );
    expect(messages.every((m) => m.jsonrpc === '2.0')).toBe(true);
    expect(messages.find((m) => m.id === 2)?.result?.tools).toHaveLength(6);
    expect(code).toBe(0);
  }, 30_000);
});
