# P06b — Consolidation + jobs

**Status:** planned (expanded 2026-10-17)

## Goal
Add the "sleep" phase (SPEC §8). Recent turns are clustered and summarized. Their fact candidates go back through the normal write path with provenance-aware merging, so facts already extracted are *confirmed*, not double-counted. Facts that consolidation creates or confirms move to `long_term`, the only path there. Schedules: consolidation nightly from GitHub Actions; the decay sweep and demo cleanup through pg_cron on the hosted database.

## Spec refs
§8 (consolidation), §6.4 (background jobs), §7.2 step 3 (provenance-aware merge), §9.3 (summaries after a purge), §3 (`supabase/hosted/`), §14 (keep-alive), §15 P6.

## Depends on / unlocks
- **Depends on:** P06a (decay sweep, purge).
- **Unlocks:** P07 (`engram_consolidate`), P09/P10 (the hosted demo's background jobs).

## Design decisions
1. **Clusters are sessions.** Unconsolidated `turn` episodes are grouped by namespace and session, split where consecutive embeddings drift apart (cosine < 0.5), and capped at 12 turns. Sessions with ≥12 unconsolidated turns go first (§8).
   - **Budget rule:** a cluster whose turns are all low-importance (max importance < `minImportance`, 0.3) is marked consolidated **without a model call**. Small talk has nothing to consolidate. On dev-long that skips the filler sessions.
2. **`summarize()` returns a summary paragraph plus fact candidates, each citing the turns that support it.** Turns are labelled `t1…tn` in the prompt (ids never reach a prompt). Each candidate's provenance is exactly its cited turns. A fact already extracted from those same turns therefore merges *without* a confidence bump (§7.2 step 3), and only genuinely new support raises confidence.
3. **Candidates go through the existing pipeline unchanged:** predicate normalization, temporal hints, entity resolution, conflict resolution. Hints resolve against the cited turn's date.
4. **Promotion:** every fact a consolidation candidate creates or merges into is set to `long_term`. Nothing else ever writes `long_term` (asserted by a test that searches the code).
5. **Summary episodes** (`kind = 'summary'`, role `system`, `summarizes` = the cluster) are embedded and recallable, and are never re-extracted. Source turns are marked `consolidated`.
6. **Purge follow-ups from P06a:**
   - when a purge deletes a summary, its surviving source turns become unconsolidated again, so the next run regenerates it;
   - the job re-embeds turns whose embeddings the purge removed.
7. **Demo cleanup** is a portable SQL function, `engram.engram_cleanup_demo(now)`, tested locally.
8. **Schedules are generated, not hand-written.**
   - `pnpm db:hosted-cron` writes `supabase/hosted/0002_cron_schedules.sql` from `config` (the decay parameters and static predicates).
   - A unit test fails if the committed file drifts from the generator.
   - pg_cron uses `create extension if not exists pg_cron with schema pg_catalog`, and named jobs replace themselves on re-run.
9. **`pnpm jobs:consolidate`** runs against `DATABASE_URL`. It caps clusters per run, prints an estimate first, and uses the key failover.
10. **`consolidate.yml`** runs nightly and on dispatch. It skips cleanly when `HOSTED_DATABASE_URL` is unset.

## Testing budget (two free keys)
| Test | Gemini calls | When |
|---|---|---|
| Unit and integration tests (FakeProvider) | 0 | always |
| Live check of the summarize prompt (1 cluster) | 1–2 | today (fallback key) |
| Recorded summarize fixtures for 3 of the P02 conversations | ~3 | today |
| Bench: dev-long with consolidation (`engram_consolidated`), cached replay, about 4 summarized clusters per persona | ~35 summarize + ~40 compose + a few adjudications ≈ 90 | today (fallback key, ~490 left) |
| Spare | ~350 left today; ~1,000/day from tomorrow | |

Bench items share personas, so identical clusters are summarized once and cache-hit for every other item.

## Deliverables
```
packages/core/src/consolidate/{cluster,prompt,consolidate}.ts (+ tests)
packages/core/src/providers/gemini.ts        # + summarize
packages/core/src/forget/purge.ts            # deleted summaries → turns unconsolidated
supabase/migrations/0005_demo_cleanup.sql    # engram_cleanup_demo(now)
supabase/hosted/0002_cron_schedules.sql      # generated
scripts/{consolidate,hosted-cron}.ts         # jobs:consolidate, db:hosted-cron
.github/workflows/consolidate.yml
bench/runner/modes.ts                        # + engram_consolidated (opt-in, not in "all")
```

## Tasks
1. Clustering and the importance skip (pure, tests first).
2. Summarize contract changes (cited turns), wire schema, prompt, Gemini implementation; one live check.
3. `consolidate()`: summarize, resolve candidates with promotion, write summary episodes, mark turns. Includes the provenance merge test and the only-path-to-`long_term` test.
4. Purge follow-ups (unconsolidate, re-embed), and demo cleanup (migration and test).
5. The `jobs:consolidate` CLI, the cron generator plus hosted SQL and drift test, and the workflow.
6. Bench `engram_consolidated` on dev-long; report and analysis.

## Tests
- **Clusters:** per session, split on embedding drift, capped at 12; big sessions first; low-importance clusters skipped without a call.
- **Provenance:** re-extracting a fact from its own turns merges with confidence unchanged; a cluster citing a *new* turn raises it.
- **Tiers:** consolidated facts are `long_term`; ordinary processing never writes `long_term`.
- **Summaries:** written with `summarizes`; source turns marked consolidated; summaries are never re-extracted; a summary deleted by a purge is regenerated on the next run.
- **Demo cleanup:** expired demo namespaces are deleted with everything in them; unexpired and non-demo namespaces stay.
- **Cron:** the generated SQL equals the committed file and uses the config's parameters.
- **Workflow:** it skips without the secret (checked by inspecting the workflow file).

## Definition of done
- [ ] Clustering and prioritization, with the budget skip.
- [ ] `summarize()` with cited turns. Summary episodes written, source turns marked.
- [ ] Candidates resolve through the unchanged pipeline; the provenance merge test passes; consolidation is the only path to `long_term`.
- [ ] `pnpm jobs:consolidate` runs end to end on the local Docker DB.
- [ ] `consolidate.yml`: nightly and on dispatch, skips without the secret.
- [ ] `supabase/hosted/0002_cron_schedules.sql` is generated from config, applied only by `db:migrate:hosted`, and drift-tested.
- [ ] The demo-cleanup function is portable and tested.
- [ ] Purge-deleted summaries regenerate on the next run.
- [ ] A dev-long bench report with consolidation, within the budget above.

## Planned commits
1. `feat(consolidate): cluster unconsolidated turns by session`
2. `feat(core): summarize clusters with cited turns`
3. `feat(consolidate): confirm facts through the write path and promote them`
4. `feat(db): clean up expired demo namespaces`
5. `feat(jobs): add consolidation and hosted schedules`
6. `feat(bench): measure dev-long with consolidation`

## Risks and verify-at-build-time
- **Hints in summaries** are relative to the cited turn. A candidate citing turns from different days uses the latest one; that's documented.
- **Recall and summaries:** summaries compete with facts in recall; watch recall@8 on dev-long.
- **pg_cron** can't run locally (plain pgvector image). The schedule SQL is checked for drift, and verified on Supabase in P10.
- **GitHub scheduled workflows** pause after 60 days of repo inactivity (README, P10).
