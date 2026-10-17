# Engram-Bench — dev-long split, run 2026-10-17-devlong-buffer

2026-10-17 · system model `gemini-3.5-flash-lite` · judge `openai/gpt-oss-120b` · 35 items

## Accuracy by category

| category | n | buffer |
|---|---|---|
| cross_session_recall | 11 | 45% |
| knowledge_update | 7 | 100% |
| temporal_reasoning | 5 | 80% |
| single_session_recall | 5 | 100% |
| multi_hop | 3 | 0% |
| abstention | 4 | 100% |
| **all** | 35 | **71%** |

## Abstention and cost

| mode | abstention precision | abstention recall | real calls / item | cached / item | prompt tokens / item | latency p50 | latency p95 |
|---|---|---|---|---|---|---|---|
| buffer | 31% | 100% | 0.9 | 0.1 | 852 | 4797 ms | 5710 ms |

Latency includes cache hits, so it understates cold runs. Real calls and tokens count only what this run sent to the network.

## Misses

- `dev-002` buffer (cross_session_recall): Remind me, what am I allergic to? — expected *pollen*, got "I don't know." (abstained on an answerable question)
- `dev-004` buffer (multi_hop): Which city does my sister live in? — expected *Nairobi*, got "I don't know." (abstained on an answerable question)
- `dev-012` buffer (cross_session_recall): Remind me, what am I allergic to? — expected *penicillin*, got "I don't know." (abstained on an answerable question)
- `dev-013` buffer (cross_session_recall): What's my favourite food? — expected *tacos*, got "I don't know." (abstained on an answerable question)
- `dev-018` buffer (multi_hop): Which city does my sister live in? — expected *Porto*, got "I don't know." (abstained on an answerable question)
- `dev-022` buffer (cross_session_recall): What's my parrot called? — expected *Olive*, got "I don't know." (abstained on an answerable question)
- `dev-026` buffer (cross_session_recall): Which instrument do I play? — expected *violin*, got "I don't know." (abstained on an answerable question)
- `dev-027` buffer (cross_session_recall): What's my dog called? — expected *Mochi*, got "I don't know." (abstained on an answerable question)
- `dev-029` buffer (multi_hop): Which city does my sister live in? — expected *Denver*, got "I don't know." (abstained on an answerable question)
- `dev-035` buffer (temporal_reasoning): Going only on what I'd told you by 16 May 2024, which city did you think I lived in then? — expected *Marseille*, got "You lived in Berlin." (expected value missing)
