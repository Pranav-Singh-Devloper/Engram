# P06a — Decay + purge

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Make forgetting principled and testable. A SQL decay sweep driven by a simulated clock archives low-retention facts under the §9.1 invariant, and `forget` supports archive, retract and an irreversible hard purge that leaves no trace.

## Spec refs
§9.1 (retention score, invariant, crossing times), §9.2 (sweep rules and exemptions), §9.3 (forget modes, purge order in one transaction), §6.4 (decay as a parameterized SQL function), §15 P6.

## Depends on
P05. Access tracking feeds `access_score` and `last_accessed_at`.

## Definition of done
- [ ] `engram.engram_decay_sweep(now, params...)` lives in a portable migration. Weights, τ and θ are passed from `packages/core/src/config` (the source of truth), not hard-coded in SQL.
- [ ] Simulated-clock tests cover:
  - the invariant (archivable ⇔ `importance < 0.6`);
  - default-importance crossing at ~42 days in `working` and ~270 days in `long_term`;
  - exemptions (pinned, static predicates, the self `is_named` fact);
  - one `fact_revisions` row per archive (`archive`/`decay`);
  - no movement between `working` and `long_term`.
- [ ] `forget` archive (reversible, with restore) and retract (sets `invalidated_at`) work through the P03 mechanics.
- [ ] The hard purge follows the §9.3 order in one transaction and requires an explicit flag. The purge test asserts that an FTS search for the purged literal returns nothing across facts, revisions (`candidate` jsonb) and episodes, and that no dangling `revises`/`superseded_by` remain.
- [ ] A test for partial redaction: an episode that also holds other facts is redacted, not deleted.

## Carried in from P03

- **Versions are one fact.** Decay must score and archive the current version, not stale ones. `access_score` and `last_accessed_at` are copied into each new version.
- **Purge:** "the whole `revises` chain in both directions" now includes merge versions as well as update copies, and backfills link to their successor through `superseded_by`.

## Risks and verify-at-build-time
- **Summary regeneration on purge** depends on P06b. Until then, summaries that cover purged episodes are deleted (the simpler option), and P06b adds regeneration.
- **Float drift** between TS config and SQL: the tests compute expected scores in TS and compare them with the SQL output within a tolerance.
