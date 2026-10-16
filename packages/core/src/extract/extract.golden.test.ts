// Golden tests over recorded fixture conversations (P02). Each conversation's
// recorded model output is replayed through the real pipeline, and the
// resulting entities and facts are compared with a committed snapshot in
// fixtures/expected/. Re-record with `pnpm fixtures:record` after a prompt
// change, then review both diffs.
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UNKNOWN_START } from '../db/client.js';
import { ingest } from '../ingest/ingest.js';
import { processEpisode } from '../ingest/process.js';
import type { ProcessSummary } from '../ingest/process.js';
import { EXPECTED_DIR, loadConversations, replayProvider } from '../testing/fixtures.js';
import { testDb, withTestNamespace } from '../testing/db.js';
import { PROMPT_VERSION } from './prompt.js';

const db = testDb();
const totals = { facts: 0, adHoc: 0 };

afterAll(async () => {
  await db.end();
});

const day = (d: Date | null) =>
  d === null
    ? null
    : d.getTime() === UNKNOWN_START.getTime()
      ? 'unknown'
      : d.toISOString().slice(0, 10);

interface EntityRow {
  name: string;
  type: string | null;
  aliases: string[];
  description: string | null;
  isSelf: boolean;
}
interface FactRow {
  subject: string;
  predicate: string;
  predicateAdHoc: boolean;
  object: string;
  statement: string;
  validFrom: Date;
  validFromSource: string;
  validTo: Date | null;
  confidence: number;
  sources: number;
}

const conversations = loadConversations();

describe('extraction golden fixtures', () => {
  it('has the expected set of fixtures', () => {
    expect(conversations.length).toBeGreaterThanOrEqual(10);
  });

  for (const conversation of conversations) {
    it(conversation.id, async () => {
      const { recording } = conversation;
      if (!recording)
        throw new Error(`${conversation.id} has no recording; run pnpm fixtures:record.`);
      expect(
        recording.promptVersion,
        'recorded with an older prompt; run pnpm fixtures:record and review the diff',
      ).toBe(PROMPT_VERSION);

      const fake = replayProvider(recording);
      await withTestNamespace(db, async ({ namespace }) => {
        const summaries: Omit<ProcessSummary, 'episodeId'>[] = [];
        for (const ep of conversation.episodes) {
          const episode = await ingest(db, fake, {
            namespaceId: namespace.id,
            sessionId: ep.sessionId,
            role: ep.role,
            content: ep.content,
            occurredAt: new Date(ep.occurredAt),
          });
          const { episodeId: _id, ...summary } = await processEpisode(db, fake, episode.id);
          summaries.push(summary);
        }

        const entities = await db<EntityRow[]>`
          select name, type, aliases, description, is_self from entities
          where namespace_id = ${namespace.id} order by is_self desc, name, description`;
        // Same-name entities (two Sams) are told apart by their description.
        const facts = await db<FactRow[]>`
          with labels as (
            select id, case when count(*) over (partition by lower(name)) > 1
                            then name || ' [' || coalesce(description, '?') || ']' else name end as name
            from entities where namespace_id = ${namespace.id}
          )
          select s.name as subject, f.predicate, f.predicate_ad_hoc,
                 coalesce(o.name, '"' || f.object_literal || '"') as object, f.statement,
                 f.valid_from, f.valid_from_source, f.valid_to, f.confidence,
                 cardinality(f.source_episode_ids) as sources
          from facts f
          join labels s on s.id = f.subject_id
          left join labels o on o.id = f.object_id
          where f.namespace_id = ${namespace.id}
          order by s.name, f.predicate, object`;

        totals.facts += facts.length;
        totals.adHoc += facts.filter((f) => f.predicateAdHoc).length;

        const snapshot = {
          id: conversation.id,
          covers: conversation.covers,
          summaries,
          entities,
          facts: facts.map((f) => ({
            fact: `${f.subject} ${f.predicate} ${f.object}`,
            adHoc: f.predicateAdHoc,
            statement: f.statement,
            validFrom: `${day(f.validFrom) ?? ''} (${f.validFromSource})`,
            validTo: day(f.validTo),
            confidence: Math.round(f.confidence * 100) / 100,
            sources: f.sources,
          })),
        };
        await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(
          path.join(EXPECTED_DIR, `${conversation.id}.json`),
        );
      });
    });
  }

  // Runs last (tests in a file run in order). SPEC §18: above ~15% on dev,
  // expand the registry. Fixtures deliberately include ad-hoc relations.
  it('reports the ad-hoc predicate rate', () => {
    expect(totals.facts).toBeGreaterThan(0);
    const rate = ((100 * totals.adHoc) / totals.facts).toFixed(1);
    console.info(`fixtures: ${totals.facts} facts, ${totals.adHoc} ad hoc (${rate}%)`);
  });
});
