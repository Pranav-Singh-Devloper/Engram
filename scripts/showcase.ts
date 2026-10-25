// The showcase namespace (SPEC §11, P10 decision 3, ADR-020): the read-only
// story anonymous visitors see. It's the bitemporal story `demo:offline` and
// the architecture explorer use (update, correction, backfill, unknown start),
// extracted turn by turn by the live model through the real write path, with
// record times set to when each turn was learned. Then it's checked: every
// canonical answer must match the story's expected one, or the namespace is
// discarded, so a bad extraction never becomes the showcase. One answer may
// be missing (LIVE_GAPS): per-turn extraction sees no earlier turns, so "And
// before that, Marseille." yields nothing (found 2026-10-23; ledger row 49).
import { randomUUID } from 'node:crypto';
import { ensureNamespace, getNamespaceBySlug, setFactPinned, transaction } from '@engram/core';
import type { Provider, Sql } from '@engram/core';
import { STORY_NOW, STORY_QUESTIONS, STORY_TURNS, Scenario } from '@engram/core/testing';

export interface SeedResult {
  namespaceId: string;
  facts: number;
  answers: { ask: string; got: string[]; expected: string[]; ok: boolean; gap?: string }[];
  invariantProblems: string[];
}

/**
 * Questions a live extraction may leave unanswered, with the reason. An empty
 * answer is accepted for these; a wrong one never is. Scripted runs allow none.
 */
export const LIVE_GAPS: Record<string, string> = {
  'Where did they live in 2010?':
    'per-turn extraction has no cross-turn context, so "before that" in "And before that, Marseille." resolves to nothing',
};

/**
 * Pins every current belief in the showcase (SPEC §9.2: pinned facts are exempt
 * from decay). The story's facts carry 2024 record times and visitors' reads
 * don't count as access, so without this the nightly sweep archives them and
 * the showcase empties (seen 2026-10-24: 4 facts archived). New versions copy
 * the pin; facts consolidation inserts later need `seed:showcase --pin` again.
 * Returns how many facts were newly pinned.
 */
export async function pinShowcase(db: Sql, slug: string): Promise<number> {
  const ns = await getNamespaceBySlug(db, slug);
  if (!ns) throw new Error(`No namespace "${slug}".`);
  const rows = await db<{ id: string }[]>`
    select id from facts where namespace_id = ${ns.id} and invalidated_at is null and not pinned`;
  for (const r of rows) await setFactPinned(db, r.id, true);
  return rows.length;
}

export class ShowcaseExistsError extends Error {
  override name = 'ShowcaseExistsError';
}

/**
 * Seeds `slug` with the story. `provider` extracts each turn (the live model);
 * without one, the turns' scripted candidates are used (tests, offline).
 * Refuses an existing namespace unless `replace`. Throws if any answer is wrong.
 */
export async function seedShowcase(
  db: Sql,
  options: { slug: string; provider?: Provider; replace?: boolean },
): Promise<SeedResult> {
  const existing = await getNamespaceBySlug(db, options.slug);
  if (existing && !options.replace) {
    throw new ShowcaseExistsError(
      `Namespace "${options.slug}" already exists; pass --replace to rebuild it.`,
    );
  }
  // Built and verified under a temporary slug, then swapped in one transaction,
  // so a failed rebuild leaves the old showcase in place.
  const building = `${options.slug}-building-${randomUUID().slice(0, 8)}`;
  // kind 'user': the nightly demo cleanup deletes only 'demo' namespaces.
  const ns = await ensureNamespace(db, { slug: building, kind: 'user' });
  try {
    const s = new Scenario(db, ns, undefined, options.provider);
    for (const turn of STORY_TURNS) await s.tell(turn);
    s.clock.set(STORY_NOW);
    const answers = [];
    for (const q of STORY_QUESTIONS) {
      const got = await s.values(q.predicate, { validAt: q.validAt, knownAt: q.knownAt });
      const exact = JSON.stringify(got) === JSON.stringify(q.expected);
      const gap = options.provider && got.length === 0 ? LIVE_GAPS[q.ask] : undefined;
      answers.push({
        ask: q.ask,
        got,
        expected: q.expected,
        ok: exact || gap !== undefined,
        ...(gap ? { gap } : {}),
      });
    }
    const invariantProblems = await s.checkInvariants();
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from facts where namespace_id = ${ns.namespace.id}`;
    const result = {
      namespaceId: ns.namespace.id,
      facts: row?.n ?? 0,
      answers,
      invariantProblems,
    };
    const wrong = answers.filter((a) => !a.ok);
    if (wrong.length > 0 || invariantProblems.length > 0) {
      const detail = [
        ...wrong.map(
          (a) =>
            `${a.ask} → ${a.got.join(', ') || '(nothing)'}, expected ${a.expected.join(', ') || '(nothing)'}`,
        ),
        ...invariantProblems,
      ];
      throw new Error(`The showcase failed verification:\n  ${detail.join('\n  ')}`);
    }
    await transaction(db, async (tx) => {
      await tx`delete from namespaces where slug = ${options.slug}`;
      await tx`update namespaces set slug = ${options.slug} where id = ${ns.namespace.id}`;
    });
    await pinShowcase(db, options.slug);
    return result;
  } catch (err) {
    // Never leave a half-built or wrong showcase behind.
    await db`delete from namespaces where id = ${ns.namespace.id}`;
    throw err;
  }
}
