# P05 — Retrieval

**Status:** planned (expanded 2026-10-17)

## Goal
Implement `recall()` as specified (§6.2) and the full composer (§6.3), and tune them on a dev split where retrieval actually matters. Before tuning, fix the two inputs the P04 dev runs showed were off: the predicate registry (34% ad-hoc) and record time on episodes.

## Spec refs
§6.2 (read path), §6.3 (composer), §5.1 (canonical filters), §7.1 (registry), §13.1 (dev-only tuning), §13.5 (recall@8), §18 (predicate drift), §15 P5.

## Depends on / unlocks
- **Depends on:** P04 (runner, dev split, inspect).
- **Unlocks:** P06a (decay reads access tracking), P07 (MCP `engram_recall`), P09 (chat).

## Design decisions
1. **Expand the registry first** (SPEC §18; dev ad-hoc rate 34%).
   - Add, from the dev runs' ad-hoc predicates:
     - `occupation` (one, dynamic)
     - `sibling_of` (many, static)
     - `partner_of` (one, dynamic)
     - `allergic_to` (many, dynamic)
     - `has_pet` (many, dynamic)
     - `plays` (many, dynamic)
     - `learning` (many, dynamic)
   - Each comes with the synonyms the model actually produced (`has_occupation`, `job_title`, `profession`, …).
   - The recorded fixtures are re-recorded, since the predicate list is part of every extraction input.
2. **A `dev-long` split for tuning.**
   - **Same questions, longer histories:** the same 8 personas and 40 questions as `dev`, with filler sessions interleaved (requests, small talk, unrelated tasks; no personal facts). That takes histories to about 60–80 user turns, three to four times the buffer window, so rag has to search and recall@8 means something.
   - **Frozen `dev` stays the regression check.** `dev-long` is the tuning set; test is untouched (§13.1).
   - **Budget-bound:** a few hundred turns per persona would cost thousands of free-tier extraction calls. About 70 per persona is roughly 500 calls cold, about 45 minutes at 12 RPM, then cached.
3. **Record time on episodes.** `ingest` takes the engine clock and sets `created_at`, so the episode filter (`occurred_at <= T and created_at <= K`) is correct in replays.
4. **`recall()` in core** (§6.2):
   - **Candidate lists:** vector top-40 facts, vector top-20 episodes, FTS top-20 over both, all under the canonical filters, plus 1-hop graph expansion from the entities in the top-10 candidates.
   - **Ranking:** RRF (`k_rrf = 60`) with recency and importance priors, and a min-max weighted-linear alternative.
   - **Abstention floor:** if the best raw cosine is below `θ_floor`, the result is empty.
   - **Access tracking:** batched. Archived hits are restored to `working`, with a `restore` revision.
   - **HNSW** uses pgvector's iterative scan, so selective filters don't starve candidate lists.
5. **Relevance labels for recall@8 are automatic.** A recalled memory is relevant if its text contains the item's expected answer. That's cheap and objective, but it misses paraphrase; the limitation is stated in reports. Abstention items are excluded.
6. **Composer.**
   - Dates are given as month and year (dev-019).
   - An explicit prompt-injection test checks the untrusted memory block.
   - `usedMemoryIds` drives access tracking in chat (P09); MCP recall tracks everything returned.

## Deliverables
```
packages/core/src/conflict/predicates.ts      # + 7 predicates
packages/core/src/retrieve/{recall,lists,fuse,graph}.ts
packages/core/src/retrieve/*.test.ts, recall.int.test.ts
packages/core/src/ingest/ingest.ts            # clock → created_at
packages/core/src/compose/prompt.ts           # month + year
bench/dataset/filler.ts                       # filler sessions (registry-blind)
bench/dataset/dev-long.json                   # frozen tuning split
bench/runner/modes.ts                         # engram uses core recall()
bench/runner/report.ts                        # + recall@8 (engram, rag)
```

## Tasks
1. Registry expansion, fixture re-recording, golden snapshot review.
2. `ingest` clock → `created_at`, and the episode filter helper.
3. Composer date wording and the injection test.
4. `recall()`: lists, graph expansion, fusion (RRF and linear), floor, access tracking. Retrieval fixture tests come first.
5. Bench engram mode on core `recall()`; recall@8 in reports.
6. Filler generator and `dev-long.json`, with automatic checks and a review pass.
7. Runs: dev (regression) and dev-long (tuning). Choose the ranker and `θ_floor` on dev-long, and record the ADR with numbers.

## Tests
- **Lists:** each respects valid time, record time and the archived tier; FTS finds a literal the embedding misses.
- **Graph expansion:** "where does my sister live" surfaces the sister's city fact.
- **Fusion:** RRF orders a candidate found by several lists above a one-list candidate. Priors break ties toward recent and important memories. The linear ranker normalizes.
- **Floor:** an unrelated query abstains.
- **Access tracking:** returned facts get `access_score + 1`; `trackAccess=false` changes nothing; an archived hit returns to `working` with a `restore` revision.
- **Episodes:** a replayed episode's `created_at` follows the clock.
- **Composer:** an instruction planted in a memory is not followed (Fake), and dates render with the year.

## Definition of done
- [ ] Registry expanded; the dev ad-hoc rate is re-measured and recorded.
- [ ] `recall()` with all candidate lists, graph expansion, RRF and linear ranking, the abstention floor and access tracking; retrieval fixture tests pass.
- [ ] Composer finished: untrusted block, `supported`/`usedMemoryIds`, month-and-year dates.
- [ ] `dev-long.json` generated, checked, reviewed and committed.
- [ ] Dev regression report and dev-long tuning report committed, including recall@8 for engram and rag.
- [ ] The ranker choice, `θ_floor`, and the dev recall@8 and accuracy targets are recorded in DECISIONS.md, citing dev-long numbers only.

## Planned commits
1. `feat(core): expand the predicate registry from dev ad-hoc predicates`
2. `fix(core): record episodes at the engine clock's time`
3. `feat(compose): give dates with month and year`
4. `feat(retrieve): add recall candidate lists and graph expansion`
5. `feat(retrieve): fuse candidates with rrf and priors, with an abstention floor`
6. `feat(retrieve): track access and restore archived hits`
7. `feat(bench): use core recall and report recall@8`
8. `feat(bench): add a long-history dev split for tuning`

## Free-tier notes
- **Re-recording fixtures:** about 25 Gemini calls. **dev-long generation:** about 100 Qwen calls.
- **A cold dev-long engram run** is about 500 extraction calls plus about 160 compose calls, roughly an hour at 12 RPM. Baselines and re-runs are mostly cached.
- **Tuning sweeps re-run only the compose step** (extraction is cached), so each costs about 40 calls per setting. Keep sweeps small.

## Risks and verify-at-build-time
- **Verify:** pgvector `hnsw.iterative_scan` in 0.8.7 (`relaxed_order`), and FTS `websearch_to_tsquery` behaviour on short questions.
- **Overfitting 40 questions:** prefer few coarse parameters, and report variance across seeds of the filler where affordable.
- **Automatic relevance labels** undercount when the answer is paraphrased. Report the definition next to the number.
- **Filler turns may plant facts.** The filler generator gets a forbid list (persona names, places, relationships, abstention topics) and is checked like the verbalizer.
