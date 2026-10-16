# P05 — Retrieval

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Implement `recall()` as specified: temporally filtered candidate lists, graph expansion, fusion with priors, an abstention floor, the full answer composer, and access tracking. Tuning is done only against the dev split, and the ranking choice is recorded as an ADR.

## Spec refs
§6.2 (read path), §6.3 (composer with `supported` and `used_memory_ids`, untrusted-data block), §5.1 (canonical as-of filter, reused from P03's `asOfPredicate`), §7.3, §13.1 (dev-only tuning), §15 P5.

## Depends on
P04: dev split and runner. Without them there's nothing to tune against.

## Definition of done
- [ ] Vector top-40 over facts, vector top-20 over episodes, and FTS top-20 over both, all filtered with `asOfPredicate`.
- [ ] 1-hop graph expansion from the top-10 candidates' entities, under the same temporal filter.
- [ ] RRF (`k_rrf = 60`) with the recency and importance priors. The weighted-linear alternative is also implemented. The dev split picks one, recorded in an ADR with numbers.
- [ ] The abstention floor `θ_floor` is tuned on dev. The composer returns zod-validated `{answer, supported, used_memory_ids}`.
- [ ] Access tracking is batched, only for used memories (composer ids for chat, all returned for MCP), off for dashboard reads, and restores archived hits to `working`.
- [ ] Retrieval fixture tests pass (unit, FakeProvider).
- [ ] Dev recall@8 and accuracy targets are recorded in DECISIONS.md. P03's merge threshold is re-tuned here.

## Carried in from P03

- **Use `asOfPredicate`** (`temporal/asOf.ts`) for every candidate list. It's the only place the canonical filter is written.
- **Version chains:** frequent restatements create several versions of one fact, and only the current one passes the as-of filter. Retrieval shouldn't need to dedupe versions, but check that recall@8 isn't diluted.
- **Re-tune `mergeThreshold` (0.9) on dev.** Literal paraphrases barely miss it with fake embeddings (0.89).

## Risks and verify-at-build-time
- **Overfitting 40 items:** prefer a few coarse parameters over many fine ones, and report the variance across seeds where possible.
- **HNSW plus a temporal pre-filter** can return too few rows under a selective filter. Check `hnsw.ef_search` and the iterative-scan options in the installed pgvector version.
- **Prompt injection through memories:** the untrusted-data block and statement-length cap from §6.3 get a dedicated test.
