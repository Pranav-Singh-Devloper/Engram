# Engram-Bench — dev-long split, run 2026-10-17-devlong-baselines

2026-10-17 · system model `gemini-3.5-flash-lite + gemini-embedding-2 embeddings` · judge `openai/gpt-oss-120b` · 40 items

## Accuracy by category

| category | n | rag | full_context |
|---|---|---|---|
| cross_session_recall | 12 | 100% | 100% |
| knowledge_update | 8 | 100% | 100% |
| temporal_reasoning | 6 | 100% | 100% |
| single_session_recall | 6 | 100% | 100% |
| multi_hop | 4 | 100% | 100% |
| abstention | 4 | 100% | 100% |
| **all** | 40 | **100%** | **100%** |

## Retrieval recall@8

Share of answerable items where a retrieved memory contains the expected answer (automatic labels; a paraphrased answer counts as a miss).

| mode | recall@8 | n |
|---|---|---|
| rag | 97% | 36 |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| rag | 100% | 100% | 1.1 | 1.9 | 569 | 4764 ms | 44494 ms |
| full_context | 100% | 100% | 1.0 | 0.0 | 1430 | 4979 ms | 5943 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Misses

