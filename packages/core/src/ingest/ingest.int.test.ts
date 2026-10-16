import { afterAll, describe, expect, it } from 'vitest';
import { SimClock } from '../config/clock.js';
import { getEpisode } from '../db/episodes.js';
import { cosine } from '../db/vector.js';
import { FakeProvider, fakeEmbedding } from '../providers/fake.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { ingest } from './ingest.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

describe('ingest', () => {
  it('stores the episode with a document embedding and leaves processing for later', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const fake = new FakeProvider();
      const before = new Date();
      const episode = await ingest(db, fake, {
        namespaceId: namespace.id,
        sessionId: 'session-a',
        role: 'user',
        content: 'I moved to Berlin in March.',
      });

      expect(await getEpisode(db, episode.id)).toEqual(episode);
      expect(episode).toMatchObject({
        kind: 'turn',
        role: 'user',
        sessionId: 'session-a',
        processedAt: null,
        consolidated: false,
        importance: 0.5,
      });
      // pgvector stores float32, so compare direction rather than exact values.
      expect(
        cosine(episode.embedding ?? [], fakeEmbedding('I moved to Berlin in March.')),
      ).toBeCloseTo(1, 6);
      expect(fake.callsTo('embed')).toEqual([
        { texts: ['I moved to Berlin in March.'], purpose: 'document' },
      ]);
      expect(episode.occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });
  });

  it('keeps an explicit historical occurredAt', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const occurredAt = new Date('2023-03-15T10:00:00Z');
      const episode = await ingest(db, new FakeProvider(), {
        namespaceId: namespace.id,
        sessionId: 's',
        role: 'assistant',
        content: 'Noted.',
        occurredAt,
      });
      expect(episode.occurredAt).toEqual(occurredAt);
    });
  });

  it('records the episode at the engine clock, not the database clock', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const learned = new Date('2024-06-10T09:00:00Z');
      const episode = await ingest(
        db,
        new FakeProvider(),
        {
          namespaceId: namespace.id,
          sessionId: 's',
          role: 'user',
          content: 'hi',
          occurredAt: learned,
        },
        { clock: new SimClock(learned) },
      );
      expect(episode.createdAt).toEqual(learned);
    });
  });

  it('stores and embeds tool output like any other turn', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const episode = await ingest(db, new FakeProvider(), {
        namespaceId: namespace.id,
        sessionId: 's',
        role: 'tool',
        content: '<html>Sam lives in Rome</html>',
      });
      expect(episode.role).toBe('tool');
      expect(episode.embedding).not.toBeNull();
    });
  });

  it('rejects blank content before calling the provider', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const fake = new FakeProvider();
      await expect(
        ingest(db, fake, {
          namespaceId: namespace.id,
          sessionId: 's',
          role: 'user',
          content: '  ',
        }),
      ).rejects.toThrow(/empty/);
      expect(fake.calls).toHaveLength(0);
    });
  });

  it('stores nothing when embedding fails', async () => {
    await withTestNamespace(db, async ({ namespace }) => {
      const failing = { embed: () => Promise.reject(new Error('quota exhausted')) };
      await expect(
        ingest(db, failing, {
          namespaceId: namespace.id,
          sessionId: 's',
          role: 'user',
          content: 'hi',
        }),
      ).rejects.toThrow(/quota/);
      expect(await db`select 1 from episodes where namespace_id = ${namespace.id}`).toHaveLength(0);
    });
  });
});
