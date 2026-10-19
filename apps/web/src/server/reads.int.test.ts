import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureNamespace } from '@engram/core';
import type { NamespaceWithSelf } from '@engram/core';
import { Scenario, aboutSelf, hint, testDb } from '@engram/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, testRoutes } from './testing';

const db = testDb();
const t = testRoutes(db, { showcaseSlug: `test-showcase-${randomUUID()}` });
let mine: NamespaceWithSelf;
let showcase: NamespaceWithSelf;
let other: NamespaceWithSelf;

/** Paris, then a move to Berlin (Paris is closed and revised), and a job. */
async function story(ns: NamespaceWithSelf, city = 'Berlin') {
  const s = new Scenario(db, ns);
  await s.tell({
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris.',
    candidates: [aboutSelf('lives_in', 'Paris')],
  });
  await s.tell({
    at: '2024-06-10T09:00:00Z',
    content: `I moved to ${city} in March.`,
    candidates: [aboutSelf('lives_in', city, { from: hint.month(3) })],
  });
  await s.tell({
    at: '2024-07-01T09:00:00Z',
    content: 'I work at Acme.',
    candidates: [aboutSelf('works_at', 'Acme', { type: 'org' })],
  });
}

beforeAll(async () => {
  mine = await ensureNamespace(db, { slug: t.tokenSlug });
  showcase = await ensureNamespace(db, { slug: t.config.showcaseSlug ?? '' });
  other = await ensureNamespace(db, { slug: `test-other-${randomUUID()}` });
  await story(mine);
  await story(showcase, 'Lisbon');
  await story(other, 'Rome');
});
afterAll(async () => {
  await db`delete from namespaces where id = any(${[mine.namespace.id, showcase.namespace.id, other.namespace.id]}::uuid[])`;
  await db.end();
});

const get = (p: string, auth = true) =>
  new Request(`http://localhost${p}`, {
    headers: auth ? { authorization: `Bearer ${TEST_TOKEN}` } : {},
  });
type Memories = {
  total: number;
  memories: { statement: string; retention: number; sources: { content: string }[] }[];
};
const memories = async (p: string, auth = true) =>
  (await (await t.routes.memories(get(p, auth))).json()) as Memories;

describe('GET /api/memories', () => {
  it("lists the token namespace's current beliefs, ranked by retention, with provenance", async () => {
    const m = await memories('/api/memories');
    expect(m.memories.map((x) => x.statement).sort()).toEqual([
      'The user lives in Berlin.',
      'The user lives in Paris.', // the closed Paris row (valid until March) is a current belief
      'The user works at Acme.',
    ]);
    const scores = m.memories.map((x) => x.retention);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(m.memories.find((x) => x.statement.includes('Acme'))?.sources[0]?.content).toBe(
      'I work at Acme.',
    );
  });

  it('filters by predicate and text, and can include replaced versions', async () => {
    expect((await memories('/api/memories?predicate=works_at')).total).toBe(1);
    expect((await memories('/api/memories?q=Berlin')).memories.map((x) => x.statement)).toEqual([
      'The user lives in Berlin.',
    ]);
    // The open-ended Paris belief was replaced by the closed one: 4 versions in all.
    expect((await memories('/api/memories?all=true')).total).toBe(4);
  });

  it('rejects a malformed query', async () => {
    expect((await t.routes.memories(get('/api/memories?tier=nope'))).status).toBe(400);
    expect((await t.routes.memories(get('/api/memories?limit=1000'))).status).toBe(400);
  });

  it('shows anonymous visitors the showcase, and never another namespace', async () => {
    const m = await memories('/api/memories', false);
    expect(m.memories.map((x) => x.statement)).toContain('The user lives in Lisbon.');
    expect(m.memories.map((x) => x.statement)).not.toContain('The user lives in Rome.');
  });
});

describe('GET /api/entities/:id/timeline', () => {
  it('returns the entity and its history, optionally with revised versions', async () => {
    const res = await t.routes.timeline(get('/api/entities/x/timeline'), mine.selfEntity.id);
    const body = (await res.json()) as { entity: { isSelf: boolean }; entries: unknown[] };
    expect(body.entity.isSelf).toBe(true);
    expect(body.entries).toHaveLength(3);
    const all = await t.routes.timeline(
      get('/api/entities/x/timeline?includeRevised=true'),
      mine.selfEntity.id,
    );
    expect(((await all.json()) as { entries: unknown[] }).entries).toHaveLength(4);
  });

  it("is 404 for another namespace's entity and for a non-uuid id", async () => {
    expect((await t.routes.timeline(get('/x'), other.selfEntity.id)).status).toBe(404);
    expect((await t.routes.timeline(get('/x'), 'not-a-uuid')).status).toBe(404);
  });
});

describe('GET /api/evals', () => {
  it('lists valid bench summaries newest first and skips anything else', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'engram-evals-'));
    const summary = (runId: string, finishedAt: string) => ({
      schema: 1,
      runId,
      split: 'test',
      date: finishedAt.slice(0, 10),
      finishedAt,
      retrievalOnly: false,
      model: 'm',
      judge: 'j',
      items: 1,
      modes: { engram: { accuracy: 1, n: 1, recallAt8: 1 } },
    });
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify(summary('old', '2026-10-01T00:00:00Z')));
    writeFileSync(path.join(dir, 'b.json'), JSON.stringify(summary('new', '2026-10-19T00:00:00Z')));
    writeFileSync(path.join(dir, 'c.json'), '{"not": "a summary"}');
    writeFileSync(path.join(dir, 'd.md'), '# report');
    const r = testRoutes(db, { reportsDir: dir });
    const body = (await r.routes.evals().json()) as { runs: { runId: string }[] };
    expect(body.runs.map((x) => x.runId)).toEqual(['new', 'old']);
    rmSync(dir, { recursive: true });
    expect(((await testRoutes(db).routes.evals().json()) as { runs: unknown[] }).runs).toEqual([]);
  });
});
