# P08 — Bench full

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Produce the honest, external numbers: freeze the 200-item test split, validate the LLM judge against human labels, adapt a LongMemEval-S subset, run all modes, and publish reports, wins and losses alike.

## Spec refs
§13.1 (test split, never used for tuning), §13.2 (generator rules, human review), §13.4 (judge validity), §13.5 (metrics), §13.6 (LongMemEval subset and free-quota shrink rule), §13.7 (`bench.yml`), §17 item 5, §18, §15 P8.

## Depends on
P07, so the engine is feature-complete before anything is measured. It can overlap with P09a/b while runs wait on quota.

## Definition of done
- [ ] `test.json` (200 items, the §13.1 category counts) is human-reviewed and frozen. From here on, a test-motivated change needs an ADR.
- [ ] 40 test answers are hand-labeled, and judge agreement with the human labels is reported.
- [ ] `bench/longmemeval/` adapter for a stratified LongMemEval-S subset (target ~100; ≥50 if the pre-run estimate forces it, with an ADR).
- [ ] Test and LongMemEval reports exist in `bench/reports/` for all four modes, with every §13.5 metric including cost per item.
- [ ] The README table shows all four modes, the LongMemEval number and judge agreement.
- [ ] `bench.yml`: manually triggered or nightly, keys from secrets, resumable via the cache artifact.

## Risks and verify-at-build-time
- **Verify:** the LongMemEval repo, license, format and question types. Record the license in the README.
- **Free quotas are the bottleneck.** `full_context` on LongMemEval-S is ~115k tokens per item, so budget from the pre-run estimate and expect a multi-day run. The cache plus resumability make that safe.
- **Groq judge limits** across 200 + ~100 items × 4 modes. Judge only `llm`-judged items, and cache the verdicts.
- **If `full_context` wins,** report it and shift the pitch toward cost, latency and as-of queries (§18).
