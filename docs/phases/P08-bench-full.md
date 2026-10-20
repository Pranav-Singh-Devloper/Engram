# P08 — Bench full

**Status:** done (2026-10-21)

## Goal
Produce the honest, external numbers:
- freeze a 200-item test split with histories long enough to separate the modes;
- validate the LLM judge against human labels;
- adapt a stratified LongMemEval-S subset;
- run every mode, and publish the wins and the losses.

All of it must fit two free Gemini keys (~500 generate calls a day each), so the phase opens by making extraction affordable at scale.

## Spec refs
§13.1 (test split, never tuned on), §13.2 (generator rules, review), §13.4 (judge validity), §13.5 (metrics), §13.6 (LongMemEval and the shrink rule), §13.7 (`bench.yml`), §6.1 (write path; batched extraction changes it), §17 item 5, §18, §15 P8.

## Depends on / unlocks
- **Depends on:** P07 (the engine is feature-complete).
- **Unlocks:** P10 (the README's bench tables). P09a/b can overlap while runs wait on quota.

## Why the plan starts with batching (ledger row 18)
Per-turn extraction costs one generate call and one embedding call per turn. LongMemEval-S, measured on the downloaded file (2026-10-17):
- **Shape:** 500 items averaging 47.7 sessions, 10.4 turns per session and 122k tokens.
- **Overlap:** only 22% of session slots repeat across items.

| | turns | per turn | one session per call | packed, ≤ 20k tokens per call |
|---|---|---|---|---|
| test split (40 personas × ~70 turns, shared across items) | ~2,800 | ~2,800 | **~720** | not used (record time must stay exact) |
| LongMemEval-S, stratified 98 items | 46,400 | 46,400 | 4,464 | **~570–650** |

Two keys give ~950 usable calls a day after a 10% margin (row 19). Per-turn takes weeks, per-session about five days, and packed under one day, so the 100-item target needs no shrink ADR.

## Alternatives considered (researched 2026-10-17)
| option | verdict |
|---|---|
| **Pack whole sessions into token-budgeted calls** (this plan) | **chosen.** Biggest lever (7× fewer calls than per-session on LongMemEval), same model, no new provider. Risk: missed details. Mitigation: raw turns stay embedded for episode recall, and a parity gate runs on dev and dev-long |
| One call per session | used for the test split, whose `known_at` questions need exact record times; ~5 days for LongMemEval |
| Gemini Batch API (50% price, 24h turnaround) | not available on the free tier; its limits start at Tier 1 ([batch docs](https://ai.google.dev/gemini-api/docs/batch-mode), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)) |
| Gemma 4 on the Gemini API (`gemma-4-26b-a4b-it`, separate quota) | works free with JSON mode, but took 29 s for a tiny prompt (1,048 thinking tokens). Kept as overflow headroom for extraction only, and only if it passes the parity gate |
| Other Gemini models' separate quotas (3.1-flash-lite, 2.5-flash-lite) | possible headroom, but mixing system models within a role muddies results; only as a declared, per-role choice |
| Groq for extraction | the free limit that binds is ~200K tokens/day for gpt-oss and qwen, about 10 packed calls ([Groq limits](https://console.groq.com/docs/rate-limits)) |
| Cerebras, Mistral free tiers | free status uncertain, or it requires opting into training on submitted data ([comparison](https://ianlpaterson.com/blog/free-llm-api-2026/)); a new provider for little certainty |
| Local model via Ollama (M3 Pro, 18 GB) | free and unlimited, but ~1–3 min per 20k-token call, i.e. 15–30 h, and only 11 GB of disk free. Rejected at this scale |
| Shrink LongMemEval to 50 items | unnecessary with packing; it stays the §13.6 fallback |

## Scope
**In:**
- **Batched extraction** (`processSessions`: one session per call, or packed sessions) for bulk ingest. The live per-turn path (MCP, chat) is unchanged.
- **One prompt pass** (rows 22 and 27).
- **The test split:** generated, reviewed and frozen.
- **The human-label judge check:** a labelling sheet you fill in.
- **The LongMemEval adapter** with a measured, stratified subset.
- **Runs and reports:** all modes on test; engram, `engram_consolidated` and full_context (plus cheap rag) on LongMemEval.
- **`bench.yml`.**
- **Report additions:** the adjudication rate, consolidation inserts, and session-mode cost.
- **Every open ledger row targeting P08:** 11, 12, 17, 18, 19, 22, 27, 28, 30, 32, 36.

**Out:**
- tuning anything on test or LongMemEval;
- LongMemEval-M;
- running any bench against the Neon database (ADR-014: it's never the bench target).

## Design decisions
1. **`processSessions(db, provider, sessions, { maxTokens, maxSessions })`** packs consecutive sessions, in time order, into structured calls of at most `maxTokens` (default 20k), splitting only a session that alone exceeds it.
   - **Test split:** `maxSessions: 1`, one session per call, so each fact's record time is its own session.
   - **LongMemEval:** packed, because it asks no record-time questions. Reports state the mode.
   - **Output:** per-turn importance, plus candidates that each cite the turns supporting them (`t1…tn`, as consolidation does).
   - **Pipeline:** candidates go through the same `resolveCandidates` pipeline, in order of their latest cited turn. Provenance is the cited turns; hints and the bench's record time come from the latest cited turn; each episode gets its own importance and is marked processed.
   - **Turn roles:** assistant turns are visible as context but candidates must cite at least one user turn, and tool output is excluded, keeping §6.1's rules.
   - **Where it's used:** the bench and bulk imports. MCP and chat stay per turn for latency.
   - **Embeddings:** ingest embeds a session's turns in one batch call, truncating each to the model's input limit (verify at build).
2. **Parity gate before any test run.** On dev and dev-long, session mode must match per-turn mode within noise: accuracy ≥ 95%, recall@8 ≥ 95%, ad-hoc rate ≤ 15%, duplicate entities ≤ 2%. If it misses, fix it on dev or record the gap; never tune on test.
3. **The prompt pass happens once, before any re-recording** (rows 22 and 27). It fixes fixture 08 (the brother mapped to `partner_of`), makes the summarizer say "the user", never he/she, and writes the new session prompt. All three prompt versions bump together, and fixtures plus the smoke cache are re-recorded once.
4. **The test split** comes from the existing generator.
   - **Size:** 40 personas, 200 items in the §13.1 counts.
   - **Filler:** 12 filler sessions per persona, so histories are ~60–80 turns, beyond the 20-turn buffer, and rag has to search.
   - **Rules:** §13.2 holds (≥ 30% off-registry relations, paraphrased restatements, implicit updates).
   - **Review:** I read every persona's turns against its timeline, as for dev, and note hand edits in `review`. Then it's frozen.
5. **Judge validity** (row 17). After the test run, `pnpm bench:label` writes a sheet of 40 stratified `llm`-judged answers: question, expected answer, and the mode's answer, without the judge's verdict. **You label each correct or incorrect** (about 15 minutes), and the report gives agreement and Cohen's κ.
6. **LongMemEval** (`bench/longmemeval/`):
   - **Data:** download `longmemeval_s_cleaned.json` (MIT, 277 MB) to the gitignored `bench/longmemeval/data/`.
   - **Adapter:** each item becomes a `BenchItem` (sessions with dates; the question asked at `question_date`). Abstention is items whose id ends in `_abs`.
   - **Sizing:** the subset is stratified across all six question types, with abstention kept in proportion. Its size comes from a measured pre-run estimate: unique sessions after cross-item overlap (haystack sessions repeat), times the per-session cost.
   - **Rule:** target 100 items, never below 50, never dropping a type (§13.6), with an ADR for the chosen size.
   - **Judging:** our Groq judge, with the LongMemEval answer as `expected`. Rows are labelled "our judge, not GPT-4o", so the numbers aren't mistaken for the paper's.
7. **Modes:** engram and `engram_consolidated` run in session-extraction mode on test and LongMemEval, and the reports say so. Baselines are unchanged. full_context on LongMemEval is ~115k tokens a call, within flash-lite's context and the free plan's per-minute token limit at ~2 calls a minute.
8. **Report additions:**
   - the adjudication rate (row 12);
   - consolidation inserts, with a read-through of the inserted facts (row 28);
   - extraction calls per item by mode.
9. **Retrieval items, tuned on dev only:**
   - **Row 32:** test a subject-match prior (prefer facts about the self entity when the question is about the user) with retrieval-only runs on dev-long. Embeddings only; keep it only if recall@8 doesn't drop.
   - **Row 11:** check the merge threshold for paraphrase splits on dev-long with `bench:inspect`, at 0 calls.
10. **`bench.yml`:** manual dispatch for test or LongMemEval, with keys from secrets. The cache travels as a workflow artifact so runs resume. Off by default, never scheduled, so it can't burn quota unattended.

## Deliverables
```
packages/core/src/ingest/sessions.ts           # processSessions (+ tests)
packages/core/src/extract/sessionPrompt.ts      # wire schema + prompt
packages/core/src/providers/{contracts,gemini,fake}.ts   # + processSessions, batch embed
bench/runner/modes.ts                           # --extraction=turn|session
bench/dataset/test.json                         # frozen
bench/longmemeval/{download,adapter,select}.ts  # + data/ (gitignored)
bench/runner/{label,agreement}.ts               # bench:label, judge agreement
bench/reports/test-*.md|json, longmemeval-*.md|json
.github/workflows/bench.yml
DECISIONS.md                                    # ADR-015 packed extraction (with the alternatives above)
```

## Tasks
1. **Session extraction:** contract, wire schema, prompt, Gemini and Fake, `processSessions` (per-session and packed), batch embeddings. FakeProvider tests first: provenance per cited turn, user-turn citation rule, tool exclusion, packing within the token budget, idempotence.
2. **Prompt pass and re-recording:** fixture 08, the summarizer pronoun, the session prompt. Re-record fixtures and the smoke cache, and add session mode to the smoke replay. If the smoke cache grows past ~6 MB (4.2 MB now), store its embedding vectors compactly (row 30).
3. **Parity on dev and dev-long** (decision 2), plus rows 11 and 32 on dev-long. Report.
4. **Report additions** (decision 8).
5. **Test split:** generate, review, freeze. Run all modes over two days.
6. **LongMemEval:** download, adapter tests on a fixture slice, the measured estimate (done: ~600 packed calls for 98 items), subset runs.
7. **Judge agreement:** `bench:label` sheet → your labels → agreement and κ in the report.
8. **`bench.yml`;** close the phase with README tables drafted for P10. (Row 36, the nightly secrets, was done during planning.)

## Tests
- **processSessions:**
  - each candidate's provenance equals its cited turns;
  - a candidate citing only assistant turns is dropped;
  - tool turns are never sent;
  - packs respect `maxTokens` and `maxSessions`, and an oversized session is split;
  - re-running is a no-op;
  - importance is per episode;
  - results equal per-turn processing on a scripted two-turn session.
- **Batch embedding:** one call for N turns, and truncation keeps texts within the limit.
- **Bench:** `--extraction=session` runs the same items, and the estimate counts session calls.
- **LongMemEval adapter:**
  - item mapping (dates, roles, `_abs` → abstention);
  - stratified selection keeps every type;
  - the overlap estimate is deterministic, on a 3-item fixture slice (committed, tiny).
- **Agreement:** κ and agreement on a hand-made table; `bench:label` hides verdicts.
- **Report:** the adjudication-rate and consolidation-insert sections.

## Definition of done
- [x] `processSessions` (per-session and packed) with cited-turn provenance, used by the bench; per-turn MCP and chat paths unchanged. _ADR-015; a bad pack reply falls back to per-turn (1895724)._
- [x] Session mode passes the parity gate on dev and dev-long (or the gap is recorded). _dev-long: 100% / recall@8 97%, the same as per-turn (47c2134). dev-long holds every dev story session plus filler, so it subsumes dev, which saturates at 100% in every mode (ADR-010); dev wasn't rerun. Packed: 95% / 94% (2026-10-19-devlong-packed), used only for LongMemEval._
- [x] One prompt pass (rows 22 and 27); fixtures and smoke cache re-recorded; CI replays session mode too. _Rows 22 and 27 in 3d84aab; row 43 and CI's session-mode replay in 9d46231._
- [x] `test.json` (200 items, the §13.1 category counts) is reviewed and frozen (cab417b). From here on, a test-motivated change needs an ADR.
- [x] 40 test answers are hand-labelled by you, and judge agreement with κ is reported. _Changed 2026-10-19: 10 test + 30 LongMemEval answers. Only 35 test answers in all five modes went to the llm judge, all "When did I move to X?", so they barely test it. LongMemEval is judged by the llm on every item and is varied. Abstentions are excluded from both sheets: a rule scores them, not the judge (c67df86)._
- [x] `bench/longmemeval/` adapter with a stratified ~100-item subset (every type, abstention in proportion). _98 items (ecc7636)._
- [x] Test and LongMemEval reports exist for every mode, with every §13.5 metric, including cost per item. _LongMemEval `engram_consolidated` deferred (ledger row 46)._
- [x] README table draft: all modes, the LongMemEval number and judge agreement (`docs/benchmarks.md`).
- [x] `bench.yml`: manually triggered, keys from secrets, resumable via the cache artifact (ba6e4b9).
- [x] Ledger rows 11, 12, 17, 18, 19, 22, 27, 28, 30, 32 and 36 are closed or explicitly re-shifted. _All closed; P08 opened rows 43–46 (43 done; 44–46 target P10)._

## Planned commits
1. `feat(core): extract facts from packed sessions in one call`
2. `feat(core): embed a session's turns in one batch`
3. `fix(core): one prompt pass for relations and summaries`
4. `feat(bench): run engram with session extraction`
5. `feat(bench): report adjudication and consolidation inserts`
6. `feat(bench): freeze the test split`
7. `feat(bench): adapt a stratified LongMemEval-S subset`
8. `feat(bench): label answers and measure judge agreement`
9. `ci: add a manual bench workflow`
10. `docs: close P08 with the test and LongMemEval results`

## Testing budget (two free keys, ~950 usable generate calls a day)
| Day | Work | Gemini generate calls | Other |
|---|---|---|---|
| 1 (today, fallback ~375 left) | build (0), fixture re-record (~22), dev-long parity: per-session (96 sessions) and packed (~10) extraction, engram compose (~80) | ~210 | embeddings |
| 2 | smoke re-record (~120), test generation (Groq verbalizer ~720 of 1K/day), test per-session extraction (~720, cached across items) | ~840 | Groq ~720 |
| 3 | summaries (~200), compose for 5 modes (~1,000, split days 3–4) | ~950 | Groq judge |
| 4 | remaining compose; LongMemEval: 98-item stratified subset, packed extraction (~600) | ~950 | |
| 5 | LongMemEval compose (engram, consolidated, rag, full_context ≈ 400; full_context is ~12M tokens at ~2 calls a minute) | ~400 | |
| after your labels | agreement (0) | 0 | |

**To verify on day 1:** gemini-embedding-2's free limits. LongMemEval needs ~46k turn embeddings (~11M tokens), batched 100 per request. A short, timed burst checks the rate before the full run.

**Verified 2026-10-19, and the plan changed (ADR-018):** the free quota counts each embedded *text*, not each request, so batching saves nothing. LongMemEval's ~45k unique turns would take ~11 days on four keys. LongMemEval therefore runs on Gemini generation with local embeddings (embeddinggemma), and the test split stays fully on Gemini over two days of quota. The bench now caches vectors per text, so repeated turns aren't paid for twice.

**LongMemEval run notes (2026-10-19).**
- **Judge fix (41a2cc0).** The judge recognized an unanswerable item only by our `ABSTAIN` sentinel. LongMemEval's 5 abstention items keep an explanation as `expected`, so a correct "I don't know" was scored wrong. It now judges by category too. The results judged by the old code were deleted and re-judged from the cached answers. Dev, dev-long and test use the sentinel on every abstention item (checked), so their numbers are unchanged.
- **The Mac slept mid-run** (12:21–18:10 IST, per `pmset -g log`), which killed the rag run ("fetch failed") and stalled the rest. Long runs now go under `caffeinate -i`, which blocks idle sleep for as long as the run lasts.

Every run prints its estimate first, uses the response cache, is resumable, and stops on quota (exhausted keys fail fast; the fallback takes over). If a day's quota runs out mid-run, the next day resumes from the cache. Neon is never touched by the bench.

## Risks and verify-at-build-time
- **Session-mode quality:** one call sees more turns and may miss facts. The parity gate catches it on dev; chunking caps prompt size.
- **Verify:** gemini-embedding-2's input limit and batch size, and flash-lite's per-minute token limit, before the LongMemEval estimate.
- **LongMemEval turns can be very long** (pasted documents). Truncate for embeddings, and cap extraction input per turn (recorded in the adapter).
- **The judge is not the paper's GPT-4o.** Label it in every table, and lean on the human-agreement number for trust.
- **If full_context wins,** report it, and shift the pitch toward cost, latency and as-of queries (§18).
- **Groq judge limits** (1K requests a day): judge only `llm`-judged items, cached.
