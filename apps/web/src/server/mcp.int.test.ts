import { aboutSelf, testDb } from '@engram/core/testing';
import { FakeProvider } from '@engram/core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, testRoutes } from './testing';

const db = testDb();
const provider = new FakeProvider().when('processEpisode', 'Paris', {
  importance: 0.6,
  candidates: [aboutSelf('lives_in', 'Paris')],
});
const t = testRoutes(db, { rememberWaitDefault: false }, provider);
afterAll(async () => {
  await db`delete from namespaces where slug = ${t.tokenSlug}`;
  await db.end();
});

const URL_ = new URL('http://localhost/api/mcp');

async function connect(token: string) {
  const client = new Client({ name: 'engram-web-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(URL_, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: (url, init) => t.routes.mcp(new Request(url, init)),
    }),
  );
  return client;
}

describe('/api/mcp', () => {
  it("serves P07's tools to a bearer token, scoped to its namespace", async () => {
    const client = await connect(TEST_TOKEN);
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name)).toContain('engram_remember');
    const stored = (await client.callTool({
      name: 'engram_remember',
      arguments: { content: 'I live in Paris.' },
    })) as { structuredContent?: { status: string; episode_id: string } };
    // wait: false here; extraction is handed to `defer`, not left to a frozen function.
    expect(stored.structuredContent?.status).toBe('pending');
    await t.runDeferred();
    const [fact] = await db<{ statement: string }[]>`
      select f.statement from facts f join namespaces n on n.id = f.namespace_id where n.slug = ${t.tokenSlug}`;
    expect(fact?.statement).toBe('The user lives in Paris.');
    await client.close();
  });

  it('answers 401 without a known token', async () => {
    const res = await t.routes.mcp(
      new Request(URL_, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(res.status).toBe(401);
    await expect(connect('x'.repeat(32))).rejects.toThrow();
  });
});
