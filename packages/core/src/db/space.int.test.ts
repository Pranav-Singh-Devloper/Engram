import { afterAll, describe, expect, it } from 'vitest';
import { ingest } from '../ingest/ingest.js';
import { FakeProvider } from '../providers/fake.js';
import { recall } from '../retrieve/recall.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { EmbeddingSpaceError, bindEmbeddingSpace, getNamespace } from './namespaces.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

/** A fake provider whose vectors claim another space, as a different embedder would. */
class OtherSpace extends FakeProvider {
  override embeddingSpace() {
    return Promise.resolve('embeddinggemma:300m@85462619ee72');
  }
}

const turn = (namespaceId: string) => ({
  namespaceId,
  sessionId: 's1',
  role: 'user' as const,
  content: 'I live in Paris.',
});

describe('embedding spaces', () => {
  it('binds a namespace on its first embedding write', async () => {
    await withTestNamespace(db, async (ns) => {
      expect((await getNamespace(db, ns.namespace.id))?.embeddingModel).toBeNull();
      await ingest(db, new FakeProvider(), turn(ns.namespace.id));
      expect((await getNamespace(db, ns.namespace.id))?.embeddingModel).toBe('fake');
    });
  });

  it('refuses another space on ingest and recall once vectors exist', async () => {
    await withTestNamespace(db, async (ns) => {
      await ingest(db, new FakeProvider(), turn(ns.namespace.id));
      const other = new OtherSpace();
      await expect(ingest(db, other, turn(ns.namespace.id))).rejects.toThrow(EmbeddingSpaceError);
      await expect(
        recall(db, other, { namespaceId: ns.namespace.id, query: 'Paris', trackAccess: false }),
      ).rejects.toThrow(/db:reembed/);
      expect(other.callsTo('embed')).toHaveLength(0);
    });
  });

  it('rebinds a namespace that was bound but never written', async () => {
    await withTestNamespace(db, async (ns) => {
      await bindEmbeddingSpace(db, ns.namespace.id, new FakeProvider());
      await bindEmbeddingSpace(db, ns.namespace.id, new OtherSpace());
      expect((await getNamespace(db, ns.namespace.id))?.embeddingModel).toBe(
        'embeddinggemma:300m@85462619ee72',
      );
    });
  });
});

describe('reembedNamespace', () => {
  it('converts a namespace to another space; recall works there afterwards', async () => {
    const { reembedNamespace } = await import('./reembed.js');
    await withTestNamespace(db, async (ns) => {
      await ingest(db, new FakeProvider(), turn(ns.namespace.id));
      const other = new OtherSpace();
      const report = await reembedNamespace(db, other, ns.namespace.id);
      expect(report).toMatchObject({ space: 'embeddinggemma:300m@85462619ee72', episodes: 1 });
      expect((await getNamespace(db, ns.namespace.id))?.embeddingModel).toBe(report.space);
      const r = await recall(db, other, {
        namespaceId: ns.namespace.id,
        query: 'I live in Paris',
        floor: 0,
        trackAccess: false,
      });
      expect(r.memories.map((m) => m.text)).toContain('I live in Paris.');
      // The old space is now the one refused.
      await expect(ingest(db, new FakeProvider(), turn(ns.namespace.id))).rejects.toThrow(
        EmbeddingSpaceError,
      );
      // Re-running is harmless.
      expect(await reembedNamespace(db, other, ns.namespace.id)).toEqual(report);
    });
  });
});
