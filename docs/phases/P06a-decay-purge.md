# P06a — Decay + purge

**Status:** planned (expanded 2026-10-17)

## Goal
Make forgetting principled and testable. A parameterized SQL decay sweep, driven by a simulated clock in tests, archives low-retention facts under the §9.1 invariant. `forget` offers three modes: archive (reversible), retract (the belief was wrong), and an explicit hard purge that leaves no trace of the information anywhere it was stored.

## Spec refs
§9.1 (retention score, invariant, crossing times), §9.2 (sweep rules, exemptions), §9.3 (forget modes, purge order), §6.4 (decay as a SQL function with `now` as a parameter), §10 (`engram_forget`, stats' "last sweep"), §15 P6.

## Depends on / unlocks
- **Depends on:** P05 (access tracking feeds `access_score` and `last_accessed_at`; recall restores archived hits).
- **Unlocks:** P06b (consolidation, pg_cron schedules), P07 (`engram_forget`, `engram://stats`).

## Design decisions
1. **The sweep is one SQL function**, `engram.engram_decay_sweep(now, …params)`, in portable migration 0004. Every weight, τ, θ and the static-predicate list come from `config` and the registry through a TS wrapper, so nothing is hard-coded in SQL.
2. **`access_score` decays between sweeps:** `access_score · exp(−Δt / τ_tier)`. Δt is the time since the previous sweep, recorded in a new `engram.decay_sweeps` table, which also answers "last sweep" for stats. The first sweep has Δt = 0.
3. **Only current beliefs are scored** (`invalidated_at is null`). Replaced versions (revised or retracted) are never archived. Closed history rows (superseded) are current beliefs, so they decay like any other.
4. **Exemptions:** pinned facts, static predicates (from the registry: `birth_date`, `is_named`, `sibling_of`), and the self entity's `is_named`. Decay never moves facts between `working` and `long_term`.
5. **A TS mirror of the score** (`retentionScore`) exists for tests and the dashboard. Tests compare it with SQL within a float tolerance.
6. **`forget` targets** a fact id, or an entity plus an optional predicate. It acts on current beliefs.
   - **archive:** `tier = 'archived'`, with an `archive` revision (resolver `manual`). `restore` reverses it.
   - **retract:** the P03 mechanics: `invalidated_at = t`, `status = 'retracted'`, with a `retraction` revision.
   - **hard:** only with `confirmHard: true`. One transaction under the namespace lock, in the §9.3 order:
     1. **Purge set:** the targets plus their whole `revises` chain in both directions (merge and update versions included).
     2. **Pointers:** null out `revises`/`superseded_by` on rows outside the set that point into it (backfilled history, successors).
     3. **Revisions:** delete `fact_revisions` rows touching the set, including their `candidate` payloads.
     4. **Facts:** delete the facts; their embeddings go with them.
     5. **Episodes:** a source episode that also produced other surviving facts is **redacted** (content replaced, embedding removed, row kept so provenance stays valid). Otherwise it is deleted.
     6. **Summaries** that summarize a purged or redacted episode are deleted. P06b regenerates them.
     7. **Entities** left with no remaining facts are deleted (except the self entity), since their names and aliases would otherwise survive the purge.
7. **Record time:** every write uses the engine clock, including revision `created_at`.

## Deliverables
```
supabase/migrations/0004_decay.sql       # decay_sweeps table + engram_decay_sweep()
packages/core/src/decay/{score,sweep}.ts # retentionScore mirror, decaySweep wrapper
packages/core/src/forget/{forget,purge}.ts
packages/core/src/decay/*.test.ts, forget/*.int.test.ts
```

## Tasks
1. Write the score mirror and its invariant/crossing-time unit tests first (pure TS).
2. Migration 0004 and the sweep wrapper; SQL tests on a simulated clock, compared with the mirror.
3. `forget` archive, restore and retract, with revisions.
4. Hard purge in the §9.3 order; no-trace, chain, pointer, redaction, summary and orphan-entity tests.
5. Export the API; update SPEC §9 where the design made choices (Δt source, redaction, orphan entities).

## Tests
- **Invariant:** after a very long idle time, a fact is archived iff `importance < 0.6` (0.55 yes; 0.6 and 0.65 no).
- **Crossing times:** default importance, never accessed, crosses at 14·ln 20 ≈ 41.9 days in `working` and 90·ln 20 ≈ 269.6 days in `long_term`. A sweep just before keeps the fact; just after archives it.
- **Access:** accesses delay archiving; `access_score` decays by `exp(−Δt/τ)` between sweeps.
- **Exemptions:** pinned, static predicates, and self `is_named` are never archived.
- **Scope:** replaced versions are untouched, and so are tiers `working` ↔ `long_term`. Exactly one `archive`/`decay` revision per archived fact. A sweep is recorded.
- **Mirror:** TS `retentionScore` equals the SQL score within 1e-5.
- **Forget:** archive then restore round-trips; retract disappears for `knownAt ≥ t` and remains before; hard without the flag throws.
- **Purge leaves no trace:**
  - FTS for the purged literal finds nothing in facts, episodes or revision candidates;
  - no fact row of the chain survives;
  - no dangling `revises`/`superseded_by`;
  - an orphaned entity is gone;
  - a shared episode is redacted, not deleted, and its other fact survives with valid provenance;
  - a summary over a purged episode is deleted.

## Definition of done
- [ ] `engram_decay_sweep` lives in a portable migration, parameterized from `config` and the registry.
- [ ] The invariant, crossing times, access decay, exemptions, scope and revision tests pass on a simulated clock.
- [ ] `forget` archive/restore/retract work through the existing mechanics.
- [ ] The hard purge follows the §9.3 order in one transaction behind an explicit flag, and the no-trace tests pass.
- [ ] SPEC §9 updated with the design's choices.

## Planned commits
1. `feat(decay): add the retention score with its archival invariant`
2. `feat(db): add the decay sweep as a parameterized sql function`
3. `feat(forget): archive, restore and retract facts`
4. `feat(forget): hard-purge a fact and every trace of it`
5. `docs(spec): record decay and purge choices`

## Free-tier notes
- **None needed.** Everything is SQL and core logic tested with FakeProvider and a simulated clock.

## Risks and verify-at-build-time
- **Float drift** between `real` columns and TS doubles: compare within a tolerance, and compute the score in `double precision` in SQL.
- **Redaction is coarse:** the whole episode text is replaced, not just the purged span. That's safe (no trace), but it loses the episode's other content; its other facts keep their own statements. Recorded as a limitation.
- **pg_cron scheduling** is P06b, in `supabase/hosted/`.
