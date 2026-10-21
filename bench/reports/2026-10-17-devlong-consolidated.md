# Engram-Bench — dev-long split, run 2026-10-17-devlong-consolidated

2026-10-17 · system model `gemini-3.5-flash-lite + gemini-embedding-2 embeddings` · judge `openai/gpt-oss-120b` · 40 items

## Accuracy by category

| category | n | engram_consolidated |
|---|---|---|
| cross_session_recall | 12 | 100% |
| knowledge_update | 8 | 100% |
| temporal_reasoning | 6 | 100% |
| single_session_recall | 6 | 100% |
| multi_hop | 4 | 100% |
| abstention | 4 | 100% |
| **all** | 40 | **100%** |

## Retrieval recall@8

Share of answerable items where a retrieved memory contains the expected answer (automatic labels; a paraphrased answer counts as a miss).

| mode | recall@8 | n |
|---|---|---|
| engram_consolidated | 100% | 36 |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| engram_consolidated | 100% | 100% | 3.5 | 85.0 | 1535 | 5015 ms | 33151 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Engram store health

- Ad-hoc predicate rate: 1% of current facts (SPEC §18 threshold ~15%).
- Duplicate-entity rate: 0% of entities share a name with another.

## Consolidation

- Per item, on average: 3.8 clusters summarized, 6.9 skipped without a call, 14.6 current long_term facts.
- Candidate outcomes: inserted 38, merged 608, coexisted 5, rejected 13.

## Misses

