// The conflict resolver (SPEC §7.2) behind the write path's CandidateResolver
// seam. Classification runs under the namespace lock against fresh beliefs;
// rule decisions apply immediately. When the LLM must adjudicate, the lock is
// released, the adjudicator is asked, and its answer is applied only if the
// beliefs are unchanged when the lock is retaken. Record time `t` is read
// inside the lock, so it never precedes a concurrent writer's row.
import { config } from '../config/index.js';
import { transaction, uuidArray } from '../db/client.js';
import type { Queryable } from '../db/client.js';
import { parseFact } from '../db/factRows.js';
import type { FactRow } from '../db/factRows.js';
import type { CandidateResolver, ResolvedCandidate } from '../ingest/resolver.js';
import type { MethodInput } from '../providers/contracts.js';
import type { Fact } from '../types/index.js';
import type { Provider } from '../providers/provider.js';
import { lockNamespace } from '../resolve/lock.js';
import { applyDecision } from './apply.js';
import { getPredicate } from './predicates.js';
import type { PredicateSpec } from './predicates.js';
import { classify, fromAdjudication } from './rules.js';
import { similarityProfile } from '../config/profiles.js';
import type { Belief, ConflictConfig, ResolvedDecision } from './rules.js';

/** Current beliefs for (subject, predicate), closed history included (§7.2 step 1). */
export async function currentBeliefs(
  db: Queryable,
  c: Pick<ResolvedCandidate, 'namespaceId' | 'subjectId' | 'predicate'>,
): Promise<Belief[]> {
  const rows = await db<(FactRow & { objectName: string })[]>`
    select f.*, coalesce(o.name, f.object_literal) as object_name
    from facts f left join entities o on o.id = f.object_id
    where f.namespace_id = ${c.namespaceId} and f.subject_id = ${c.subjectId}
      and f.predicate = ${c.predicate} and f.invalidated_at is null
    order by f.valid_from, f.recorded_at, f.statement`;
  return rows.map(({ objectName, ...row }) => ({ ...parseFact(row), objectName }));
}

/**
 * A version of this same claim that the user withdrew (a correction or a
 * retraction) after every turn the candidate cites. Re-reading those turns, as
 * consolidation does, is no new evidence, so the claim must not come back; a
 * later turn that states it again is still heard.
 */
export async function withdrawnClaim(
  db: Queryable,
  c: Pick<
    ResolvedCandidate,
    'namespaceId' | 'subjectId' | 'predicate' | 'objectId' | 'objectLiteral' | 'sourceEpisodeIds'
  >,
): Promise<Fact | undefined> {
  if (c.sourceEpisodeIds.length === 0) return undefined;
  const rows = await db<FactRow[]>`
    select f.* from facts f
    where f.namespace_id = ${c.namespaceId} and f.subject_id = ${c.subjectId}
      and f.predicate = ${c.predicate}
      and f.object_id is not distinct from ${c.objectId}::uuid
      and lower(f.object_literal) is not distinct from lower(${c.objectLiteral}::text)
      and exists (
        select 1 from fact_revisions r
        where r.old_fact_id = f.id and r.kind in ('correction', 'retraction'))
      and f.invalidated_at >= (
        select max(e.occurred_at) from episodes e
        where e.id = any(${uuidArray(db, c.sourceEpisodeIds)}))
    order by f.invalidated_at desc
    limit 1`;
  const row = rows[0];
  return row && parseFact(row);
}

const fingerprint = (facts: readonly Belief[]) => facts.map((f) => f.id).join(',');

function adjudicationInput(
  c: ResolvedCandidate,
  existing: readonly Belief[],
  spec: PredicateSpec | undefined,
): MethodInput<'adjudicate'> {
  return {
    predicate: c.predicate,
    context: c.context,
    cardinality: spec?.cardinality ?? 'many',
    mutability: spec?.mutability ?? 'dynamic',
    candidate: {
      statement: c.statement,
      validFrom: c.validFrom,
      validTo: c.validTo,
      confidence: c.confidence,
      isCorrection: c.isCorrection,
    },
    existing: existing.map((e) => ({
      id: e.id,
      statement: e.statement,
      validFrom: e.validFrom,
      validTo: e.validTo,
      confidence: e.confidence,
    })),
  };
}

export function createConflictResolver(
  provider: Pick<Provider, 'adjudicate'> & Partial<Pick<Provider, 'embeddingSpace'>>,
): CandidateResolver {
  // The merge threshold depends on the embedder's similarity scale (ADR-017).
  let rules: Promise<ConflictConfig> | undefined;
  const rulesConfig = (): Promise<ConflictConfig> => {
    const space = provider.embeddingSpace?.bind(provider);
    rules ??= space
      ? similarityProfile({ embeddingSpace: space }).then((p) => ({
          ...config.conflict,
          mergeThreshold: p.merge,
        }))
      : Promise.resolve(config.conflict);
    return rules;
  };
  return {
    async resolve(db, c, { clock }) {
      const spec = getPredicate(c.predicate);
      const cfg = await rulesConfig();
      // An adjudication is only valid for the beliefs it was asked about.
      let adjudicated: { fingerprint: string; decision: ResolvedDecision } | undefined;

      for (let attempt = 0; attempt < config.conflict.maxResolveAttempts; attempt++) {
        const result = await transaction(db, async (tx) => {
          await lockNamespace(tx, c.namespaceId);
          const existing = await currentBeliefs(tx, c);
          const proposed = classify(c, existing, spec, cfg);
          // A merge only adds provenance to a current belief; anything else
          // would bring back a claim the user withdrew after its evidence.
          if (proposed.kind !== 'merge') {
            const withdrawn = await withdrawnClaim(tx, c);
            if (withdrawn) {
              const reason = 'withdrawn after the turns it cites';
              const reject = {
                kind: 'reject',
                target: withdrawn,
                resolver: 'rule',
                reason,
              } as const;
              return applyDecision(tx, reject, c, clock.now());
            }
          }
          // Rule decisions are pure and fast, so they apply under the lock
          // straight away; concurrent writers can't starve them.
          if (proposed.kind !== 'adjudicate') return applyDecision(tx, proposed, c, clock.now());
          if (adjudicated?.fingerprint === fingerprint(existing)) {
            return applyDecision(tx, adjudicated.decision, c, clock.now());
          }
          return { needsAdjudication: proposed.allowed, existing };
        });
        if (!('needsAdjudication' in result)) return result;

        // The LLM is asked outside any transaction, then the loop re-checks.
        const out = await provider.adjudicate(adjudicationInput(c, result.existing, spec));
        adjudicated = {
          fingerprint: fingerprint(result.existing),
          decision: fromAdjudication(out, c, result.existing, result.needsAdjudication),
        };
      }
      throw new Error(
        `Conflict resolution for ${c.predicate} didn't settle after ${config.conflict.maxResolveAttempts} attempts.`,
      );
    },
  };
}
