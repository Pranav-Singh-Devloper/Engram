import { afterAll, describe, expect, it } from 'vitest';
import { insertEntity } from '../db/entities.js';
import { fakeEmbedding } from '../providers/fake.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { Scenario, aboutSelf } from '../testing/scenario.js';
import { searchEntities } from './search.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

describe('searchEntities', () => {
  it('ranks name matches, then aliases, then similar labels, with fact counts', async () => {
    await withTestNamespace(db, async (ns) => {
      const s = new Scenario(db, ns);
      await s.tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I work at Acme Robotics.',
        candidates: [aboutSelf('works_at', 'Acme Robotics', { type: 'org' })],
      });
      await insertEntity(db, {
        namespaceId: ns.namespace.id,
        name: 'Robert',
        type: 'person',
        aliases: ['Bobby'],
        embedding: fakeEmbedding('Robert (person)'),
      });
      await insertEntity(db, {
        namespaceId: ns.namespace.id,
        name: 'Lyon',
        type: 'place',
        embedding: fakeEmbedding('Lyon (place)'),
      });
      const search = (query: string) =>
        searchEntities(db, s.fake, { namespaceId: ns.namespace.id, query });

      const acme = await search('acme');
      expect(acme.map((h) => [h.entity.name, h.match, h.facts])).toEqual([
        ['Acme Robotics', 'name', 1],
      ]);
      expect((await search('bobby')).map((h) => [h.entity.name, h.match])).toEqual([
        ['Robert', 'alias'],
      ]);
      const [lyon] = await search('lyon place');
      expect(lyon).toMatchObject({ match: 'similar', facts: 0, entity: { name: 'Lyon' } });
      expect(lyon?.similarity).toBeCloseTo(1, 5);
      // The self entity is never listed, and a LIKE wildcard is matched literally.
      expect(await search('user')).toEqual([]);
      expect(await search('%')).toEqual([]);
    });
  });

  it('never returns another namespace’s entities', async () => {
    await withTestNamespace(db, async (a) => {
      await new Scenario(db, a).tell({
        at: '2024-01-15T09:00:00Z',
        content: 'I live in Paris.',
        candidates: [aboutSelf('lives_in', 'Paris')],
      });
      await withTestNamespace(db, async (b) => {
        const s = new Scenario(db, b);
        expect(
          await searchEntities(db, s.fake, { namespaceId: b.namespace.id, query: 'paris' }),
        ).toEqual([]);
      });
    });
  });
});
