import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getEpisode, getFact, ingest, insertEntity } from '@engram/core';
import type { BenchSummary } from '@engram/core';
import { Scenario, aboutSelf, hint, testDb, withTestNamespace } from '@engram/core/testing';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, describe, expect, it } from 'vitest';
import { createEngramServer } from './server.js';
import type { EngramServerOptions } from './server.js';

const db = testDb();
const dirs: string[] = [];
afterAll(async () => {
  await db.end();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface ToolResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function connect(s: Scenario, options: Partial<EngramServerOptions> = {}) {
  const tasks: Promise<void>[] = [];
  const server = createEngramServer({
    db,
    provider: s.fake,
    namespaceId: s.ns.namespace.id,
    clock: s.clock,
    background: (t) => tasks.push(t),
    log: () => undefined,
    reportsDir: null,
    ...options,
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'engram-test', version: '0.0.0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call, tasks };
}

const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('\n');
/** Ids differ per run; the rest of the text must not. */
const stable = (t: string) => t.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>');

/** P03's scenario: Paris, then Berlin from March, learned in June. */
async function moved(s: Scenario) {
  await s.tell({
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris.',
    candidates: [aboutSelf('lives_in', 'Paris', { statement: 'The user lives in Paris.' })],
  });
  await s.tell({
    at: '2024-06-10T09:00:00Z',
    content: 'I moved to Berlin in March.',
    candidates: [
      aboutSelf('lives_in', 'Berlin', {
        from: hint.month(3),
        statement: 'The user lives in Berlin.',
      }),
    ],
  });
  s.clock.set('2024-07-01T00:00:00Z');
}

describe('the tool surface', () => {
  it('lists exactly the six tools, each saying when to call it', async () => {
    await withTestNamespace(db, async (ns) => {
      const { client } = await connect(new Scenario(db, ns));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'engram_consolidate',
        'engram_entities',
        'engram_forget',
        'engram_history',
        'engram_recall',
        'engram_remember',
      ]);
      for (const t of tools) expect(t.description).toMatch(/call this/i);
      expect(tools.find((t) => t.name === 'engram_forget')?.annotations?.destructiveHint).toBe(
        true,
      );
      expect(client.getInstructions()).toMatch(/engram_recall at the start of a task/);
    });
  });

  it('rejects malformed input before touching the store', async () => {
    await withTestNamespace(db, async (ns) => {
      const { call } = await connect(new Scenario(db, ns));
      for (const [tool, args] of [
        ['engram_remember', { content: '  ' }],
        ['engram_recall', { query: 'x', k: 50 }],
        ['engram_recall', { query: 'x', valid_at: 'last tuesday' }],
        ['engram_forget', { fact_id: 'not-a-uuid', mode: 'archive' }],
      ] as const) {
        const r = await call(tool, args);
        expect(r.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
        expect(textOf(r)).toMatch(/Input validation error/);
      }
    });
  });
});

describe('engram_remember', () => {
  it('stores and extracts, returning what was stored', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      s.clock.set('2024-06-10T09:00:00Z');
      s.fake.when('processEpisode', 'Paris', {
        importance: 0.7,
        candidates: [aboutSelf('lives_in', 'Paris')],
      });
      const { call } = await connect(s);
      const r = await call('engram_remember', { content: 'I live in Paris.' });
      expect(r.structuredContent).toMatchObject({
        session_id: 'mcp-2024-06-10',
        status: 'processed',
        importance: 0.7,
        extracted: 1,
        created_entities: 1,
        outcomes: { inserted: 1, merged: 0 },
      });
      expect(stable(textOf(r))).toBe(
        'Stored episode <id> (session mcp-2024-06-10).\nExtracted 1 fact: 1 inserted. 1 new entity.',
      );
      expect(await s.values('lives_in')).toEqual(['Paris']);
    });
  });

  it('with wait: false, returns at once and processes in the background', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      s.clock.set('2024-02-02T00:00:00Z');
      s.fake.when('processEpisode', 'jazz', {
        importance: 0.5,
        candidates: [aboutSelf('likes', 'jazz', { type: 'concept' })],
      });
      const { call, tasks } = await connect(s);
      const r = await call('engram_remember', {
        content: 'I love jazz.',
        session_id: 'chat-7',
        occurred_at: '2024-02-01T10:00:00Z',
        wait: false,
      });
      expect(r.structuredContent).toMatchObject({ status: 'pending', session_id: 'chat-7' });
      await Promise.all(tasks);
      const episode = await getEpisode(db, String(r.structuredContent?.episode_id));
      expect(episode?.processedAt).not.toBeNull();
      expect(episode?.occurredAt.toISOString()).toBe('2024-02-01T10:00:00.000Z');
      expect(await s.values('likes')).toEqual(['jazz']);
    });
  });
});

describe('engram_recall', () => {
  it('returns facts with provenance and both windows, as of any time, tracking access', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const { call } = await connect(s);
      const query = 'the user lives in';
      const facts = (r: ToolResult) =>
        (r.structuredContent?.memories as { kind: string; text: string }[]).filter(
          (m) => m.kind === 'fact',
        );

      const now = await call('engram_recall', { query });
      expect(facts(now).map((m) => m.text)).toContain('The user lives in Berlin.');
      const [first] = facts(now) as unknown as {
        valid_from: string;
        recorded_at: string;
        source_episode_ids: string[];
      }[];
      expect(first?.valid_from).toMatch(/^2024-0[13]-/);
      expect(first?.recorded_at).toMatch(/^2024-/);
      expect(first?.source_episode_ids).toHaveLength(1);
      expect(stable(textOf(now))).toMatch(
        /\[fact <id>\] The user lives in Berlin\. \(valid 2024-03-01 → open; known 2024-06-10T09:00:00Z → now; active; 1 source\)/,
      );

      const february = await call('engram_recall', { query, valid_at: '2024-02-01T00:00:00Z' });
      expect(facts(february).map((m) => m.text)).toEqual(['The user lives in Paris.']);
      const believedInMay = await call('engram_recall', {
        query,
        known_at: '2024-05-01T00:00:00Z',
      });
      expect(facts(believedInMay).map((m) => m.text)).toEqual(['The user lives in Paris.']);

      const [berlin] = facts(now) as unknown as { id: string; text: string }[];
      expect((await getFact(db, berlin?.id ?? ''))?.accessScore).toBeGreaterThan(0);
    });
  });

  it('says so when nothing is relevant', async () => {
    await withTestNamespace(db, async (ns) => {
      const { call } = await connect(new Scenario(db, ns));
      const r = await call('engram_recall', { query: 'quantum chromodynamics' });
      expect(textOf(r)).toBe('Nothing relevant in memory.');
      expect(r.structuredContent?.memories).toEqual([]);
    });
  });
});

describe('engram_history and engram_entities', () => {
  it("shows the user's timeline, with replaced versions on request", async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const { call } = await connect(s);
      const r = await call('engram_history', { entity: 'user', predicate: 'lives in' });
      expect(stable(textOf(r))).toBe(
        [
          'History of the user:',
          '- lives_in Paris: valid 2024-01-15T09:00:00Z → 2024-03-01; known 2024-06-10T09:00:00Z → now; superseded [fact <id>]',
          '- lives_in Berlin: valid 2024-03-01 → open; known 2024-06-10T09:00:00Z → now; active [fact <id>]',
        ].join('\n'),
      );
      const audit = await call('engram_history', { entity: 'me', include_revised: true });
      const entries = audit.structuredContent?.entries as { replaced: boolean; status: string }[];
      expect(entries.filter((e) => e.replaced).map((e) => e.status)).toEqual(['revised']);
    });
  });

  it('reports unknown and ambiguous names instead of guessing', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      for (const description of ["the user's brother", "the user's manager"]) {
        await insertEntity(db, {
          namespaceId: ns.namespace.id,
          name: 'Sam',
          type: 'person',
          description,
        });
      }
      const { call } = await connect(s);
      const unknown = await call('engram_history', { entity: 'Narnia' });
      expect(unknown).toMatchObject({ isError: true });
      expect(textOf(unknown)).toMatch(/No entity named "Narnia"/);
      const ambiguous = await call('engram_history', { entity: 'sam' });
      expect(ambiguous.isError).toBe(true);
      expect(stable(textOf(ambiguous))).toBe(
        `"sam" matches 2 entities; pass one id: Sam (person: the user's brother) id <id>; Sam (person: the user's manager) id <id>.`,
      );
    });
  });

  it('finds entities by name, with ids for the other tools', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const { call } = await connect(s);
      const r = await call('engram_entities', { query: 'berl' });
      expect(stable(textOf(r))).toBe('- Berlin (place); 1 fact [entity <id>]');
      const [berlin] = r.structuredContent?.entities as { id: string }[];
      const byId = await call('engram_history', { entity: berlin?.id });
      expect(textOf(byId)).toBe('No facts about Berlin.');
    });
  });
});

describe('engram_forget', () => {
  it('refuses a hard purge without confirm_hard, and changes nothing', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const { call } = await connect(s);
      const r = await call('engram_forget', {
        entity: 'user',
        predicate: 'lives_in',
        mode: 'hard',
      });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/confirm_hard: true/);
      expect(await s.values('lives_in')).toEqual(['Berlin']);
      expect(await s.values('lives_in', { validAt: '2024-02-01' })).toEqual(['Paris']);
    });
  });

  it('archives, retracts and hard-purges through the core mechanics', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      await s.tell({
        at: '2024-06-11T09:00:00Z',
        content: 'I love jazz.',
        candidates: [aboutSelf('likes', 'jazz', { type: 'concept' })],
      });
      s.clock.set('2024-07-01T00:00:00Z');
      const { call } = await connect(s);
      const jazz = await call('engram_history', { entity: 'user', predicate: 'likes' });
      const [entry] = jazz.structuredContent?.entries as { fact_id: string }[];

      const archived = await call('engram_forget', { fact_id: entry?.fact_id, mode: 'archive' });
      expect(archived.structuredContent).toMatchObject({
        mode: 'archive',
        fact_ids: [entry?.fact_id],
      });
      expect((await getFact(db, entry?.fact_id ?? ''))?.tier).toBe('archived');

      const retracted = await call('engram_forget', {
        entity: 'user',
        predicate: 'lives_in',
        mode: 'retract',
      });
      expect(retracted.structuredContent?.fact_ids).toHaveLength(2);
      expect(await s.values('lives_in')).toEqual([]);

      const purged = await call('engram_forget', {
        fact_id: entry?.fact_id,
        mode: 'hard',
        confirm_hard: true,
      });
      expect(purged.structuredContent?.purge).toMatchObject({ facts: 1, entities_deleted: 1 });
      expect(await getFact(db, entry?.fact_id ?? '')).toBeUndefined();

      const none = await call('engram_forget', { mode: 'archive' });
      expect(textOf(none)).toMatch(/exactly one target/);
      const gone = await call('engram_forget', { fact_id: entry?.fact_id, mode: 'archive' });
      expect(gone).toMatchObject({ isError: true });
      expect(textOf(gone)).toMatch(/Nothing matches/);
    });
  });
});

describe('engram_consolidate and engram://stats', () => {
  it('processes stragglers first, then consolidates and promotes', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      s.fake
        .when('processEpisode', 'Lisbon', {
          importance: 0.6,
          candidates: [aboutSelf('lives_in', 'Lisbon')],
        })
        .when(
          'summarize',
          () => true,
          (input) => ({
            summary: 'The user lives in Lisbon.',
            candidates: [
              {
                ...aboutSelf('lives_in', 'Lisbon'),
                sourceEpisodeIds: input.episodes.map((e) => e.id),
              },
            ],
          }),
        );
      // Stored but never processed, as when a client exits during wait: false.
      await ingest(db, s.fake, {
        namespaceId: ns.namespace.id,
        sessionId: 'mcp-2024-06-10',
        role: 'user',
        content: 'I live in Lisbon.',
        occurredAt: new Date('2024-06-10T09:00:00Z'),
      });
      s.clock.set('2024-06-11T00:00:00Z');
      const { call } = await connect(s);
      const r = await call('engram_consolidate');
      expect(r.structuredContent).toMatchObject({
        pending_processed: 1,
        pending_remaining: 0,
        summarized: 1,
        promoted: 1,
        outcomes: { merged: 1 },
      });
      expect(textOf(r)).toBe(
        [
          'Processed 1 pending episode first.',
          'Summarized 1 cluster, skipped 0 as small talk.',
          '1 candidate (1 merged); 1 fact promoted to long-term.',
        ].join('\n'),
      );
    });
  });

  it('describes the store and the newest bench summary', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await moved(s);
      const dir = mkdtempSync(path.join(tmpdir(), 'engram-reports-'));
      dirs.push(dir);
      const summary = (runId: string, date: string, accuracy: number): BenchSummary => ({
        schema: 1,
        runId,
        split: 'dev',
        date,
        model: 'm',
        judge: 'j',
        items: 40,
        modes: {
          engram: { accuracy, n: 40, recallAt8: 0.97 },
          buffer: { accuracy: 0.7, n: 40, recallAt8: null },
        },
      });
      writeFileSync(path.join(dir, 'old.json'), JSON.stringify(summary('old', '2024-01-01', 0.9)));
      writeFileSync(path.join(dir, 'new.json'), JSON.stringify(summary('new', '2024-02-01', 1)));
      writeFileSync(path.join(dir, 'junk.json'), '{"not":"a summary"}');

      const read = async (reportsDir: string | null) => {
        const { client } = await connect(s, { reportsDir });
        const r = await client.readResource({ uri: 'engram://stats' });
        const [c] = r.contents;
        return JSON.parse(c && 'text' in c ? c.text : '{}') as Record<string, unknown>;
      };
      const stats = await read(dir);
      expect(stats).toMatchObject({
        namespace: ns.namespace.slug,
        facts: { total: 2, byStatus: { active: 1, superseded: 1 }, adHocRate: 0 },
        episodes: { turns: 2, summaries: 0, unprocessed: 0 },
        entities: 2,
        bench: { runId: 'new', accuracy: { buffer: 0.7, engram: 1 } },
      });
      expect((await read(null)).bench).toBeNull();
    });
  });
});
