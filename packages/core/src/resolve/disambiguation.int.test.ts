import { afterAll, describe, expect, it } from 'vitest';
import { createDb, DEFAULT_DATABASE_URL } from '../db/client.js';
import { insertEntity } from '../db/entities.js';
import type { NamespaceWithSelf } from '../db/namespaces.js';
import type { EntityRef, MethodInput, MethodOutput } from '../providers/contracts.js';
import { FakeProvider, fakeEmbedding } from '../providers/fake.js';
import { ProviderOutputError } from '../providers/provider.js';
import type { Provider } from '../providers/provider.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { entityLabel, resolveEntity } from './entities.js';

const db = testDb();
afterAll(async () => {
  await db.end();
});

const person = (name: string, description: string | null = null): EntityRef => ({
  name,
  type: 'person',
  description,
});

function resolve(
  ns: NamespaceWithSelf,
  mention: EntityRef,
  provider: Pick<Provider, 'disambiguate'>,
  context = 'turn',
) {
  return resolveEntity(db, provider, mention, fakeEmbedding(entityLabel(mention)), {
    namespaceId: ns.namespace.id,
    selfEntity: ns.selfEntity,
    context,
  });
}

describe('two Sams', () => {
  it('keeps two same-name people apart and routes a bare mention through disambiguation', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider()
        // The manager's description conflicts with the brother's: a new person.
        .when('disambiguate', (input) => input.mention.description?.includes('manager') ?? false, {
          entityId: null,
          reason: 'different role',
        })
        // "Sam cooked dinner" is about the chef.
        .when(
          'disambiguate',
          (input) => input.context.includes('cooked'),
          (input) => ({
            entityId: input.candidates.find((c) => c.description?.includes('chef'))?.id ?? null,
            reason: 'the chef cooks',
          }),
        );

      const brother = await resolve(ns, person('Sam', "the user's brother, a chef"), fake);
      expect(brother.created).toBe(true);

      const manager = await resolve(ns, person('Sam', "the user's manager at work"), fake);
      expect(manager).toMatchObject({ created: true, via: 'new' });
      expect(manager.entity.id).not.toBe(brother.entity.id);

      const later = await resolve(ns, person('Sam'), fake, 'Sam cooked dinner for everyone.');
      expect(later).toMatchObject({ entity: { id: brother.entity.id }, via: 'disambiguation' });

      const asked = fake.callsTo('disambiguate') as MethodInput<'disambiguate'>[];
      expect(asked.map((a) => a.candidates.length)).toEqual([1, 2]);
    });
  });

  it('merges a repeated mention whose description agrees, without asking', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider();
      const first = await resolve(ns, person('Sam', "the user's brother, a chef"), fake);
      const again = await resolve(ns, person('Sam', "the user's brother, a chef"), fake);
      expect(again).toMatchObject({ entity: { id: first.entity.id }, via: 'exact' });
      expect(fake.callsTo('disambiguate')).toHaveLength(0);
    });
  });
});

describe('optimistic re-check', () => {
  it('starts over when a concurrent writer changes the candidates mid-disambiguation', async () => {
    await withTestNamespace(db, async (ns) => {
      const school = await insertEntity(db, {
        namespaceId: ns.namespace.id,
        name: 'Alice',
        type: 'person',
        description: 'a friend from school',
        embedding: fakeEmbedding(entityLabel(person('Alice', 'a friend from school'))),
      });
      let calls = 0;
      let coworkerId = '';
      const provider = {
        disambiguate: async (
          input: MethodInput<'disambiguate'>,
        ): Promise<MethodOutput<'disambiguate'>> => {
          calls++;
          if (calls === 1) {
            // While "the LLM" thinks, another writer adds a second Alice.
            const other = await insertEntity(db, {
              namespaceId: ns.namespace.id,
              name: 'Alice',
              type: 'person',
              description: "the user's coworker",
              embedding: fakeEmbedding(entityLabel(person('Alice', "the user's coworker"))),
            });
            coworkerId = other.id;
            return { entityId: null, reason: 'not the school friend' };
          }
          expect(input.candidates.map((c) => c.id).sort()).toEqual([school.id, coworkerId].sort());
          return { entityId: coworkerId, reason: 'the coworker' };
        },
      };

      const r = await resolve(
        ns,
        person('Alice', "the user's coworker on the data team"),
        provider,
      );
      expect(calls).toBe(2);
      expect(r).toMatchObject({
        entity: { id: coworkerId },
        created: false,
        via: 'disambiguation',
      });
      const alices = await db`
        select 1 from entities where namespace_id = ${ns.namespace.id} and name = 'Alice'`;
      expect(alices).toHaveLength(2);
    });
  });

  it('rejects a disambiguation that picks an id outside the candidates', async () => {
    await withTestNamespace(db, async (ns) => {
      const fake = new FakeProvider().when('disambiguate', () => true, {
        entityId: '00000000-0000-0000-0000-000000000000',
        reason: 'made up',
      });
      await resolve(ns, person('Sam', "the user's brother"), fake);
      await expect(resolve(ns, person('Sam', "the user's landlord"), fake)).rejects.toThrow(
        ProviderOutputError,
      );
    });
  });
});

describe('concurrency', () => {
  it('creates one entity when many writers resolve the same new name at once', async () => {
    // A pool wide enough that the resolves really run in parallel.
    const wide = createDb(process.env.DATABASE_URL || DEFAULT_DATABASE_URL, { max: 10 });
    try {
      await withTestNamespace(db, async (ns) => {
        const mention = person('Alice', "the user's friend");
        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            resolveEntity(wide, new FakeProvider(), mention, fakeEmbedding(entityLabel(mention)), {
              namespaceId: ns.namespace.id,
              selfEntity: ns.selfEntity,
              context: 'turn',
            }),
          ),
        );
        expect(new Set(results.map((r) => r.entity.id)).size).toBe(1);
        expect(results.filter((r) => r.created)).toHaveLength(1);
      });
    } finally {
      await wide.end();
    }
  });
});
