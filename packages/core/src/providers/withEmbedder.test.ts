import { describe, expect, it } from 'vitest';
import { FakeProvider } from './fake.js';
import { withEmbedder } from './withEmbedder.js';

describe('withEmbedder', () => {
  it('sends structured calls to the base and embeddings to the embedder', async () => {
    const base = new FakeProvider().when('compose', () => true, {
      answer: 'Lisbon',
      supported: true,
      usedMemoryIds: [],
    });
    const embedder = {
      name: 'local',
      embed: (texts: readonly string[]) => Promise.resolve(texts.map(() => [1, 0])),
      embeddingSpace: () => Promise.resolve('embeddinggemma:300m@abc'),
    };
    const p = withEmbedder(base, embedder);
    expect(await p.embed(['a', 'b'], { purpose: 'document' })).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(await p.embeddingSpace()).toBe('embeddinggemma:300m@abc');
    const out = await p.compose({ question: 'where?', memories: [], now: new Date() });
    expect(out.answer).toBe('Lisbon');
    expect(base.callsTo('compose')).toHaveLength(1);
    expect(p.name).toBe('fake+local');
  });
});
