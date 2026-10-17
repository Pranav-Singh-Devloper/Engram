// The conflict resolver (SPEC §7.2) behind the write path's CandidateResolver
// seam. Classification runs under the namespace lock against fresh beliefs;
// rule decisions apply immediately. When the LLM must adjudicate, the lock is
// released, the adjudicator is asked, and its answer is applied only if the
// beliefs are unchanged when the lock is retaken. Record time `t` is read
// inside the lock, so it never precedes a concurrent writer's row.
import { config } from '../config/index.js';
import { transaction } from '../db/client.js';
import type { Queryable } from '../db/client.js';
import { parseFact } from '../db/factRows.js';
import type { FactRow } from '../db/factRows.js';
import type { CandidateResolver, ResolvedCandidate } from '../ingest/resolver.js';
import type { MethodInput } from '../providers/contracts.js';
import type { Provider } from '../providers/provider.js';
import { lockNamespace } from '../resolve/lock.js';
import { applyDecision } from './apply.js';
import { getPredicate } from './predicates.js';
import type { PredicateSpec } from './predicates.js';
import { classify, fromAdjudication } from './rules.js';
import type { Belief, ResolvedDecision } from './rules.js';

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

export function createConflictResolver(provider: Pick<Provider, 'adjudicate'>): CandidateResolver {
  return {
    async resolve(db, c, { clock }) {
      const spec = getPredicate(c.predicate);
      // An adjudication is only valid for the beliefs it was asked about.
      let adjudicated: { fingerprint: string; decision: ResolvedDecision } | undefined;

      for (let attempt = 0; attempt < config.conflict.maxResolveAttempts; attempt++) {
        const result = await transaction(db, async (tx) => {
          await lockNamespace(tx, c.namespaceId);
          const existing = await currentBeliefs(tx, c);
          const proposed = classify(c, existing, spec);
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
