import { afterAll, describe, expect, it } from 'vitest';
import { getEpisode } from '../db/episodes.js';
import { FakeProvider } from '../providers/fake.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { aboutSelf } from '../testing/scenario.js';
import { ingest } from './ingest.js';
import { processPending } from './pending.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const turn = (namespaceId: string, content: string, at: string) =>
  ingest(db, new FakeProvider(), {
    namespaceId,
    sessionId: 's1',
    role: 'user',
    content,
    occurredAt: new Date(at),
  });

describe('processPending', () => {
  it('processes unprocessed episodes oldest first, up to the limit, in one namespace', async () => {
    await withTestNamespace(db, async (ns) => {
      await withTestNamespace(db, async (other) => {
        const fake = new FakeProvider().when('processEpisode', () => true, {
          importance: 0.5,
          candidates: [aboutSelf('likes', 'jazz', { type: 'concept' })],
        });
        const later = await turn(ns.namespace.id, 'I love jazz, still.', '2024-02-01T00:00:00Z');
        const first = await turn(ns.namespace.id, 'I love jazz.', '2024-01-01T00:00:00Z');
        const elsewhere = await turn(
          other.namespace.id,
          'I love jazz too.',
          '2024-01-01T00:00:00Z',
        );
        const run = () => processPending(db, fake, { namespaceId: ns.namespace.id, limit: 1 });

        expect(await run()).toEqual({ processed: 1, remaining: 1, error: null });
        expect((await getEpisode(db, first.id))?.processedAt).not.toBeNull();
        expect((await getEpisode(db, later.id))?.processedAt).toBeNull();
        expect(await run()).toEqual({ processed: 1, remaining: 0, error: null });
        expect(await run()).toEqual({ processed: 0, remaining: 0, error: null });
        expect((await getEpisode(db, elsewhere.id))?.processedAt).toBeNull();
      });
    });
  });

  it('stops at the first failure and reports it', async () => {
    await withTestNamespace(db, async (ns) => {
      await turn(ns.namespace.id, 'Unscripted turn one.', '2024-01-01T00:00:00Z');
      await turn(ns.namespace.id, 'Unscripted turn two.', '2024-01-02T00:00:00Z');
      const r = await processPending(db, new FakeProvider(), { namespaceId: ns.namespace.id });
      expect(r).toMatchObject({ processed: 0, remaining: 2 });
      expect(r.error).toMatch(/No scripted processEpisode/);
    });
  });
});
