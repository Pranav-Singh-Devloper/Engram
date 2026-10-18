# Engram-Bench — dev-long split, run 2026-10-18-devlong-local-C-guard

2026-10-18 · system model `ollama qwen3.5:9b` · judge `openai/gpt-oss-120b` · 40 items

## Accuracy by category

| category | n | engram |
|---|---|---|
| cross_session_recall | 12 | 100% |
| knowledge_update | 8 | 88% |
| temporal_reasoning | 6 | 83% |
| single_session_recall | 6 | 100% |
| multi_hop | 4 | 100% |
| abstention | 4 | 100% |
| **all** | 40 | **95%** |

## Retrieval recall@8

Share of answerable items where a retrieved memory contains the expected answer (automatic labels; a paraphrased answer counts as a miss).

| mode | recall@8 | n |
|---|---|---|
| engram | 97% | 36 |

## Abstention floor simulation (run floor 0.25)

| floor | accuracy | abstention recall | wrongly abstained |
|---|---|---|---|
| 0.3 | 95% | 100% | 0 |
| 0.4 | 88% | 100% | 3 |
| 0.45 | 58% | 100% | 16 |
| 0.5 | 48% | 100% | 20 |
| 0.55 | 20% | 100% | 31 |
| 0.6 | 18% | 100% | 32 |
| 0.65 | 10% | 100% | 35 |
| 0.7 | 10% | 100% | 35 |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| engram | 80% | 100% | 4.3 | 23.8 | 6526 | 2871 ms | 1314706 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Engram store health

- Ad-hoc predicate rate: 0% of current facts (SPEC §18 threshold ~15%).
- Duplicate-entity rate: 1% of entities share a name with another.
- Adjudication rate: 0% of fact revisions were decided by the LLM adjudicator rather than the rules.

## Misses

- `dev-008` engram (knowledge_update): Which city do I live in now? — expected *Denver*, got "You live in Melbourne." (expected value missing)
- `dev-019` engram (temporal_reasoning): When did I move to Valencia? — expected *April 2024*, got "I don't know." (abstained on an answerable question)
