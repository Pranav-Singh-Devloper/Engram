# P02 — Extraction + entities

**Status:** planned

## Goal
Build the slow half of the write path. `process(episodeId)` makes one LLM call for importance plus candidate facts, then normalizes predicates, resolves dates against the episode, and resolves every subject and object to a canonical entity without creating duplicates under concurrency. Facts are persisted with provenance. Conflict resolution sits behind a seam that P03 fills in.

## Spec refs
§6.1 `process` steps 1, 2 and 4 (step 3 is P03), §7.1 (registry names and synonyms only; cardinality and mutability are used in P03), §5 (entities, `is_self`), §15 P2, §18 (disambiguation risk, predicate drift).

## Depends on / unlocks
- **Depends on:** P01 (repositories, provider contracts, `ingest`).
- **Unlocks:** P03 (the resolver plugs into the seam), P04 (the bench needs real extraction).

## Scope
**In**
- The `processEpisode` prompt and Gemini implementation.
- A zod-validated candidate schema.
- The predicate registry file (names and synonyms) with normalization, and the ad-hoc flag.
- Deterministic temporal-hint resolution.
- Tool-output exclusion.
- The entity resolution ladder.
- Disambiguation (prompt and Gemini implementation).
- Alias learning.
- Fact persistence with statement embeddings.
- `processed_at`.
- A recorded-fixture mechanism.

**Out**
- Contradiction handling. The seam's P02 implementation, `insertOnlyResolver`, just inserts and logs nothing.
- The bitemporal read query.
- Consolidation-time extraction (P06b reuses this code).

## Deliverables
```
packages/core/src/
  extract/schema.ts              # zod: ProcessEpisodeOutput {importance, candidates[]}
  extract/prompt.ts              # processEpisode prompt (registry names injected, reference date injected)
  extract/temporal.ts            # resolveHint(hint, occurredAt) → Date (pure)
  extract/normalize.ts           # predicate normalization via synonym map; lowercase/snake_case
  conflict/predicates.ts         # registry: name, synonyms (cardinality/mutability filled in P03)
  resolve/entities.ts            # resolution ladder + alias learning
  resolve/disambiguate.ts        # optimistic disambiguation flow
  resolve/lock.ts                # withNamespaceLock(tx, nsId) → pg_advisory_xact_lock(hashtextextended(...))
  ingest/process.ts              # process(episodeId) orchestration
  ingest/resolver.ts             # CandidateResolver interface + insertOnlyResolver
  testing/fixtures.ts            # load/record provider fixtures
packages/core/fixtures/conversations/*.json   # ~10 conversations + recorded provider responses
scripts/record-fixtures.ts       # pnpm fixtures:record (manual, real Gemini, writes JSON)
```

## Design decisions to confirm at phase start
1. **Temporal hints, not dates.**
   - The LLM returns a structured hint instead of an ISO date:
     - `{kind:'absolute', date}`
     - `{kind:'relative', amount, unit, direction}`
     - `{kind:'named_period', month?, year?, season?}`
     - `{kind:'none'}`
   - `temporal.ts` resolves the hint against `occurred_at` in pure code. "Never wall-clock now" then becomes testable, and the model never does date arithmetic.
   - Missing `valid_from` defaults to `occurred_at` with `valid_from_source = 'episode'`. A resolved explicit hint sets `'explicit'`.
2. **No LLM call while holding the lock.**
   - Candidate entity embeddings (`"name (type): description"`) are computed before the transaction.
   - The ladder runs a read-only lookup first. If several candidates pass, `disambiguate` runs *outside* the transaction.
   - The transaction then takes `pg_advisory_xact_lock` and re-runs the lookup. If the candidate set changed (another writer created a matching entity), it retries the flow (max 2). Otherwise it applies the decision.
   - This keeps transactions short, which matters behind the transaction pooler.
3. **Self references.** The prompt instructs `subject: "SELF"` for first-person references, and code maps it to the namespace's `is_self` entity. The model never invents a name for the user.
4. **Recorded fixtures.**
   - `pnpm fixtures:record` runs the 10 conversations through real Gemini once and commits the responses.
   - Golden tests replay them through FakeProvider, so they exercise real model output with no network.
   - Re-recording is an explicit, reviewed act, and the diffs show prompt-change effects.

## Tasks
1. Write the candidate zod schema and the registry file (six predicates and their synonyms from §7.1), plus `normalize.ts`. Unknown predicates go through the synonym map, otherwise they're kept as snake_case with `predicate_ad_hoc = true`.
2. Write `temporal.ts` with exhaustive unit tests (written first).
3. Write the `processEpisode` prompt and Gemini implementation.
   - The prompt includes the registry names, the ad-hoc escape hatch, the reference date, the SELF convention, and the correction-cue instruction (`is_correction`).
   - Episode content is passed as delimited data, never as instructions.
4. Implement the entity ladder:
   1. exact match on normalized name and type;
   2. alias match;
   3. embedding ≥ `config.entityMatchThreshold` (0.85).

   Then alias append, and creation.
5. Implement the disambiguation prompt, the Gemini implementation, and the optimistic flow with lock re-check.
6. `process(episodeId)`:
   - skip if `processed_at` is set (idempotent);
   - skip extraction for `role = 'tool'` unless `config.extractFromToolOutput`;
   - extract, resolve entities, embed statements;
   - hand candidates to `CandidateResolver`;
   - set `importance` and `processed_at`;
   - return a summary `{extracted, created_entities, merged, updated, rejected}`, which `engram_remember` uses in P07.
7. Write the fixture recorder script, record the 10 conversations, and add the golden tests.

## Tests
- `temporal.test.ts` (unit):
  - "last week", "since March", "two years ago", "in 2019", and "this summer" against fixed `occurred_at` values;
  - a hint near a year boundary;
  - `none` falls back to the episode time;
  - the result never depends on the system clock (`vi.setSystemTime` set far away).
- `normalize.test.ts`: `resides_in` → `lives_in`, `employed_by` → `works_at`; an unknown predicate is flagged ad hoc; casing and spacing are normalized.
- `extract.golden.test.ts`:
  - 10 fixture conversations, replayed and compared against committed expected entities and facts snapshots;
  - covers: self references, relative dates, an ad-hoc predicate, a correction cue, a tool-role episode producing nothing, and a multi-fact turn.
- `entities.int.test.ts`:
  - exact, alias and embedding matches each hit the existing entity;
  - a new surface form appends an alias;
  - a below-threshold match creates a new entity.
- `two-sams.int.test.ts`: "my brother Sam, a chef" and "Sam from work, my manager" become two entities, and a later "Sam cooked dinner" resolves to the brother via disambiguation (scripted Fake response).
- `concurrency.int.test.ts`: 10 parallel `process()` calls on episodes all mentioning "Alice (person)" produce exactly one Alice entity. A variant where one call has to disambiguate exercises the retry path.
- `process.int.test.ts`: idempotent when re-run; provenance holds the episode id; `processed_at` is set; importance is stored.

## Definition of done
- [ ] All golden tests pass over the ~10 recorded fixture conversations.
- [ ] The concurrency test proves no duplicate entities, including the disambiguation-retry path.
- [ ] The two-Sams fixture resolves correctly.
- [ ] The ad-hoc predicate rate over the fixtures is printed by the golden test (a baseline for §18 drift).
- [ ] An ADR records the temporal-hint design and the no-LLM-under-lock rule.

## Planned commits
1. `feat(core): add predicate registry and synonym normalization`
2. `feat(extract): resolve temporal hints against episode time`
3. `feat(extract): add combined importance and fact extraction`
4. `feat(resolve): add entity resolution ladder under advisory lock`
5. `feat(resolve): disambiguate same-name entities optimistically`
6. `feat(core): process episodes into facts with provenance`
7. `test(extract): add recorded-fixture golden conversations`

## Free-tier notes
- Recording fixtures takes about 10–20 real calls in total, once. CI never calls Gemini.
- Put the reference date and registry at the start of the prompt so the prompt prefix is stable. This matters for later caching (P04).

## Risks and verify-at-build-time
- **Verify:** Gemini JSON-mode / response-schema support in the current SDK. If schema-constrained output is available, use it *and* keep the zod parse.
- **Extraction recall on implicit facts** ("enjoying the Berlin winters") will be weak. Measure it in P04 rather than over-engineering the prompt now.
- **Two-Sams is the main silent-error risk** (§18). The duplicate-entity and mis-merge metrics come in P04.
- **`hashtextextended` lock key collisions** across namespaces are harmless (extra serialization only), but note it.
