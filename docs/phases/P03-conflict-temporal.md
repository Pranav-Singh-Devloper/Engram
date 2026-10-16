# P03 — Conflict + temporal

**Status:** done (2026-10-16)

## Goal
Implement the core of the project: resolving each new candidate fact against current beliefs using versioned, immutable rows, and querying them bitemporally. This phase also ships `pnpm demo:offline`, the first thing a reviewer can run with no API key.

## Spec refs
§5.1 (bitemporal semantics, canonical query, status table), §7.1 (registry), §7.2 (resolution, including the fixed update order and the overlapping-backfill rule), §7.3 (temporal APIs), §7.4 (14 required cases), §15 P3.

## Depends on / unlocks
- **Depends on:** P02 (`CandidateResolver` seam, entity ids on candidates, provenance).
- **Unlocks:** P04 (the bench asks temporal questions), P05 (retrieval reuses the as-of filter), P06a (decay and purge rely on the version chain).

## Scope
**In**
- Registry cardinality and mutability.
- `ConflictResolver` replacing `insertOnlyResolver`.
- A shared versioning helper.
- Merge, coexist, update, backfill, correction, noise reject and static handling.
- The adjudicator (prompt, Gemini implementation, zod schema).
- `fact_revisions` logging for every outcome.
- An injectable clock.
- The canonical as-of query builder.
- `history()`.
- The `demo:offline` script.

**Out**
- Ranking and recall (P05). This phase only exposes `factsAsOf()` filtered by subject and predicate.
- Decay and archive (P06a). `forget` modes come in P06a, but retraction mechanics are built here because corrections need them.

## Deliverables
```
packages/core/src/
  config/clock.ts                # Clock { now(): Date }; systemClock; fixedClock/simClock for tests
  conflict/predicates.ts         # + cardinality, mutability per §7.1
  conflict/resolver.ts           # ConflictResolver implements CandidateResolver
  conflict/rules.ts              # pure: classify(candidate, E) → Decision | 'adjudicate'
  conflict/apply.ts              # apply(tx, decision, t): row mechanics per §7.2
  conflict/versioning.ts         # closeAndReplace / reviseWith: insert copy (recorded_at=t) + invalidate original (t)
  conflict/adjudicate.ts         # prompt + zod schema {decision: update|correction|coexist|reject, reason, flag_predicate?}
  temporal/asOf.ts               # asOfPredicate({validAt, knownAt, includeArchived}) → SQL fragment (single source)
  temporal/history.ts            # history(entityId, predicate?, {includeRevised})
scripts/demo-offline.ts          # pnpm demo:offline
```

## Design decisions to confirm at phase start
1. **One timestamp per transaction from an injected clock.** `t = clock.now()` is captured once and used for every `recorded_at` and `invalidated_at` in that transaction (§7.2). Tests drive a simulated clock, so the `knownAt` cases are exact rather than racing wall time. DB `now()` is not used for record time.
2. **Pure classification, impure application.** `rules.ts` is a pure function of `(candidate, E, registry entry)` returning a decision or `'adjudicate'`. All 14 cases are mostly table tests on it, with integration tests confirming the row mechanics.
3. **No LLM under the lock** (same pattern as P02):
   - read `E` and classify; adjudicate outside the transaction if needed;
   - then lock, re-read `E`, and compare a fingerprint (ids plus `invalidated_at`);
   - if it changed, reclassify (max 2 retries).
4. **Merge equality.** Same `object_id`, *or* normalized literal equality, *or* statement-embedding cosine ≥ `config.mergeThreshold` (tuned on dev in P05). "Adjacent" means `c.from == e.to`.
5. **Confidence on merge.** Noisy-OR `1 − (1 − e.conf)(1 − c.conf)`, capped at 0.99, applied only when `c` cites episode ids not already in `e.source_episode_ids` (§7.2.3).
6. **Explicit bound on merge.** When `c` carries an explicit bound that `e` only had by default, use `versioning.reviseWith(e, {valid_from, valid_from_source:'explicit'})`. This writes a new row with `revises = e.id`, invalidates `e` as `revised`, and uses the same helper as the update path.

## Tasks
1. **Clock + as-of builder.** Add `asOfPredicate` and unit-test the SQL fragment's semantics against hand-built rows. It is the only place the canonical query is written.
2. **Versioning helper.** Write `versioning.ts` with integration tests: the copy gets `recorded_at = t`, the original gets `invalidated_at = t`, and `revises` and `superseded_by` are wired up. Ids are generated in the app (`crypto.randomUUID()`) so `c.id` exists before the closed copy references it.
3. **Registry metadata and the pure `rules.ts`** with table tests covering:
   - merge;
   - coexist;
   - update;
   - backfill;
   - backfill overlapping a closed row (→ adjudicate);
   - correction;
   - noise;
   - static contradiction (→ correction | reject | adjudicate, never update or backfill);
   - the ambiguous fallback.
4. **`apply.ts`** executes each decision in the §7.2 order and writes exactly one `fact_revisions` row per outcome (with `candidate` jsonb for rejects).
5. **Adjudicator** prompt, Gemini implementation, and Fake scripting. `coexist` from the adjudicator on a `one` predicate records `flag_predicate` in `fact_revisions.reason` for later reclassification.
6. **`ConflictResolver`** wiring with the optimistic lock flow, replacing `insertOnlyResolver`. The `process()` summary now reports merged, updated and rejected counts.
7. **`history()`**: ordered by `valid_from`, each row with its record window. `includeRevised` adds the invalidated versions.
8. **`scripts/demo-offline.ts`.**
   - Uses `FakeProvider` with scripted extraction responses, the local DB and a sim clock.
   - Replays:
     1. Jan 2024: "I live in Paris".
     2. Jun 2024: "I moved to Berlin in March".
     3. Jul 2024: "Actually I work at Acme, not Initech".
     4. Aug 2024: "I lived in Lyon 2015–2018".
   - Prints, as a small table:
     - current city;
     - city at 2024-02-01 (`validAt`);
     - believed city as of May 2024 (`knownAt`);
     - the retraction visible before and after;
     - `history(self, 'lives_in', {includeRevised: true})`.
   - Exits non-zero if any answer differs from what's expected, so it doubles as a smoke test in CI.

## Tests
The §7.4 suite is table-driven in `conflict.int.test.ts`. Each row has a setup sequence, a sim-clock time per step, a query, and the expected rows or columns.

1. Paris → Berlin update: the closed copy's windows are correct and the original is `revised`.
2. `validAt` either side of the move returns the right city.
3. `knownAt` before the move was learned gives Paris as current; after, Berlin.
4. A correction retracts: the fact is absent for `knownAt ≥ t_retract` and present before.
5. Out-of-order backfill: older history learned later, and Berlin stays current.
6. A static-predicate (`birth_date`) contradiction resolves only as correction or reject.
7. Multi-valued (`likes`) coexistence.
8. Merge on a paraphrase.
9. Merge doesn't raise confidence when provenance overlaps (re-extracting the same episode).
10. Noise rejection, with the candidate stored in `fact_revisions.candidate`.
11. Synonym normalization: `resides_in` conflicts with `lives_in`.
12. Relative date resolution against `occurred_at` feeds the correct `valid_from`.
13. A backfill overlapping an existing closed history row goes to the adjudicator (assert a Fake `adjudicate` call).
14. No `knownAt` gap or overlap at the update instant: at `t − 1ms`, `t` and `t + 1ms`, exactly one of {open original, closed copy} is believed.

Also:
- `rules.test.ts`: pure table tests for every branch.
- `history.int.test.ts`: ordering, record windows, and the `includeRevised` toggle.
- An invariant check run after every §7.4 case: no row has content changes since insert (compare a content hash), and every non-`active` status agrees with its time columns per the §5.1 table.
- CI runs `pnpm demo:offline` after the tests.

## Definition of done
- [x] All 14 §7.4 cases pass, plus the rules, history and invariant tests.
- [x] `pnpm demo:offline` prints the expected answers with no API keys set, and runs in CI.
- [x] Every resolution outcome writes exactly one `fact_revisions` row (asserted in each case).
- [x] ADRs cover the injected clock, noisy-OR confidence, and merge equality.

## Planned commits
1. `feat(core): add injectable clock and canonical as-of filter`
2. `feat(conflict): version facts with a shared transaction timestamp`
3. `feat(conflict): classify candidates with the rule fast-path`
4. `feat(conflict): apply resolutions and log every revision`
5. `feat(conflict): adjudicate ambiguous contradictions with the llm`
6. `feat(core): add entity fact history with record-time view`
7. `test(conflict): cover the bitemporal required cases`
8. `feat(scripts): add offline bitemporal demo`

## Free-tier notes
- Nothing here hits the network. The adjudicator's real prompt is checked once by hand with 3–5 calls and recorded as fixtures, the same way as in P02.

## Carried in from P02

- **Unknown `valid_from`.** P02 drops facts that ended before the turn with no stated start ("before that, I lived in Marseille"). Decide whether to support an unknown start (e.g. `-infinity` plus a `valid_from_source = 'unknown'` migration), since backfill is exactly where these facts matter.
- **Assistant echoes** create a second row for the same fact from a different episode. Merge must absorb it, appending provenance and raising confidence only for new episodes. Fixture 09 shows the case.
- **Fixture 04** (Initech, then "Actually, I work at Acme, not Initech") is the real-model correction case. Once the resolver lands, its golden snapshot should show Initech retracted.
- **Reuse the optimistic pattern** from `resolve/entities.ts`: plan and adjudicate outside the transaction, then re-check under `lockNamespace`.
- **`ResolvedCandidate.raw`** carries the model's candidate for `fact_revisions.candidate`.

## Risks and verify-at-build-time
- **Overlapping explicit windows** from different sources ("2018–2020" vs "2019–2021") go to the adjudicator. Watch the adjudication rate on dev in P04. If it's high, add rules there, not here.
- **Clock skew between the app and the DB** no longer matters, because record time comes from the app clock. Document that a multi-instance deploy relies on reasonably synced clocks.
- **The `superseded_by` FK and insertion order:** inserting `c` first satisfies it. If a deferred-constraint approach turns out to be needed, it gets an ADR.
- **Merge threshold** starts as a guess (0.9). It's a P05 dev-split tuning target.

## Summary

Done 2026-10-16. Candidates now resolve against current beliefs through versioned, immutable rows on one transaction timestamp. `factsAsOf` is the single canonical bitemporal filter, and `history()` gives the timeline with a record-time audit view. All 14 §7.4 cases pass end to end on a simulated clock, with per-turn revision accounting and §5.1 invariant checks. `pnpm demo:offline` answers 10 bitemporal questions with no API key and runs in CI. 240 tests pass.

On the real-model fixtures (re-recorded with the adjudicator prompt):
- **04:** the correction retracts Initech.
- **09:** the assistant echo merges, with 2 sources and confidence 0.99.
- **10:** Lyon is backfilled before Paris, and Marseille before Lyon.

Deviations from the plan above:
- **Unknown starts are supported** (ADR-007, migration 0003), so end-only facts are kept instead of dropped.
- **Check order:** correction cue and noise come before update (ADR-008); otherwise §7.4 case 4 fails.
- **Corrections inherit the retracted fact's window** when they have no stated bounds.
- **Merges** write a new version whenever they change provenance, confidence or bounds. Objects compare by entity, then label, then literal paraphrase. A real-model fixture had Toronto as a literal and, after an assistant echo, as an entity, and the resolver treated that as a move.
- **Locking:** rule decisions apply under the lock. The fully optimistic version starved when ten writers restated one fact; only the LLM calls now leave the lock. Entity resolution got the same change.
- **The resolver context passes a clock**, not a fixed `recordedAt`, so `t` is read inside the lock. `insertOnlyResolver` is gone.
- **`reviseFact` invalidates the original before inserting the copy.** It's the same transaction and the same `t`, and the invalidation doubles as the currency check. The spec now states the requirement (ids generated up front, one `t`) rather than a fixed write order.
- **`history()` finds replaced versions by lineage** (`revises`), not by status.
- **Commits:** apply, the adjudicator and the resolver landed as one commit (the prompt version and the re-recorded fixtures tie them together). The correction-window rule and history were separate commits.
