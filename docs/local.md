# Engram in local mode

Local mode runs **Engram's own processing on your machine**: fact extraction, conflict adjudication, entity disambiguation, consolidation, answer composition and embeddings, all through [Ollama](https://ollama.com). It needs no API key and makes no request to any third party.

## What it does and doesn't keep local
- **Local:** everything Engram itself does with your memories. An automated test (`packages/mcp/src/egress.int.test.ts`) drives remember → recall → consolidate → stats in local mode with every non-loopback request blocked, and checks that none was attempted.
- **Not covered:** when Engram runs behind a cloud agent (Claude Code, Claude Desktop, Cursor), whatever `engram_recall` returns enters that agent's context and goes to *its* model provider. The only fully local setup is local mode plus a local agent model.

Why it matters: Gemini's free tier may use inputs to improve Google's products, and Engram stores personal facts. Local mode is the option that sends them nowhere.

## Setup (about 10 minutes, ~8.3 GB of downloads)
```bash
brew install ollama && brew services start ollama   # or https://ollama.com/download
pnpm local:setup     # checks Ollama, pulls qwen3.5:9b (7.6 GB) and embeddinggemma:300m (0.6 GB), smoke-tests both
```
Then add the lines it prints to `.env`:
```
ENGRAM_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_EMBED_MODEL=embeddinggemma:300m
```
`pnpm local:doctor` re-checks everything at any time and explains what's wrong.

## Checking it yourself
The automated test above runs in CI on every push. To see it on your own machine, turn Wi-Fi off and run:
```bash
pnpm db:up
ENGRAM_PROVIDER=ollama pnpm local:doctor     # every check passes with no network
ENGRAM_PROVIDER=ollama pnpm demo:offline --live   # the bitemporal demo, extracted by the local model
```
Everything works except steps that need the internet by design (pulling a model, the hosted demo).

Without turning Wi-Fi off, macOS can cut a single process off the network instead:
```bash
echo '(version 1)(allow default)(deny network-outbound (remote ip "*:*"))(allow network-outbound (remote ip "localhost:*"))' > offline.sb
sandbox-exec -f offline.sb env ENGRAM_PROVIDER=ollama scripts/node_modules/.bin/tsx scripts/demo-offline.ts --live
```
Run 2026-10-18 that way on an M3 Pro with qwen3.5:9b: 9 of 10 answers right in about a minute, with every non-localhost connection refused. The same command with `ENGRAM_PROVIDER=gemini` fails at once with "fetch failed", which shows the block is real. With the network up, the same demo also got 9 of 10. The miss is "And before that, Marseille.": each turn is extracted on its own, so the local model can't tell what "that" refers to and stores no dates. The scripted run (`pnpm demo:offline`, no model) gets all 10.

## Hardware
| RAM | generation model | notes |
|---|---|---|
| 16–18 GB | `qwen3.5:9b` (default) | measured on an M3 Pro, 18 GB, below |
| 8–16 GB | `qwen3.5:4b` | lighter; not yet measured (P11) |
| 32 GB+ | `qwen3.5:27b` | not tested |

Apple Silicon and NVIDIA GPUs run these at usable speed. CPU-only machines are much slower.

## What to expect
- **Recall is fast:** it's one local embedding, plus the database.
- **Remembering is slow:** extraction takes ~5–15 s a turn on an M3 Pro (generation ~29 tokens/s). So in local mode `engram_remember` returns at once and extracts in the background. `engram_recall` says when recent memories are still being processed.
- **Unfinished work resumes:** if the MCP server exits mid-queue, pending episodes are processed the next time it starts (or by `engram_consolidate`). Memories can lag behind the session that created them.

## Embedding spaces
Every namespace records the embedding model (name and digest) its vectors came from. Vectors from different models can't be compared, so switching models on an existing namespace is refused until you convert it:
```bash
pnpm db:reembed --namespace=<slug>
```
`local:doctor` lists namespaces whose model has changed, for example after `ollama pull` updated the weights behind a tag.

## Known limits
- **Quality:** a 9B model extracts less accurately than Gemini. See the bench comparison below, which separates the generation model's share of the gap from the embeddings'.
- **No constrained JSON:** Ollama can't constrain qwen3.5's output to a schema (any `format` returns 501; [ollama#14645](https://github.com/ollama/ollama/issues/14645)). The schema goes in the prompt instead, and every reply is validated and repaired once if needed.
- **Long turns:** turns over ~7,000 characters are cut before embedding (embeddinggemma reads 2K tokens). The bench reports how often that happens.
- **Not for the hosted demo:** it runs on Gemini.

## Licences
qwen3.5 is Apache-2.0. embeddinggemma is under Google's [Gemma terms](https://ai.google.dev/gemma/terms); `nomic-embed-text` (Apache-2.0, also 768-d) is the alternative.

## Bench (dev-long)
40 items, about 37 turns of history each, session extraction (ADR-015), same judge (Groq `gpt-oss-120b`). Run 2026-10-18 on an M3 Pro, 18 GB. Reports: `bench/reports/2026-10-18-devlong-session.md` (A), `2026-10-19-devlong-local-B.md` (B, 2026-10-19), `2026-10-18-devlong-local-C-counted.md` (C) and `2026-10-18-devlong-local-C-guard.md` (C′).

| row | generation | embeddings | accuracy | recall@8 | knowledge update | abstention |
|---|---|---|---|---|---|---|
| A | Gemini 3.5 flash-lite | gemini-embedding-2 | **100%** | 97% | 8/8 | 4/4 |
| B | qwen3.5:9b | gemini-embedding-2 | **93%** | 97% | 6/8 | 4/4 |
| C | qwen3.5:9b | embeddinggemma:300m | **88%** | 97% | 4/8 | 4/4 |
| C′ | C, plus one extraction rule (below) | embeddinggemma:300m | **95%** | 97% | 7/8 | 4/4 |

**Reading it.** The 12-point gap splits between the two models: swapping Gemini's generation for qwen costs 7 points (A → B), and swapping its embeddings for embeddinggemma costs 5 more (B → C). Fully local retrieval is as good as Gemini's (recall@8 97% in both), and local recall never wrongly abstains with the calibrated floor (ADR-017). Four of row C's five misses are the same mistake. A later turn mentions an old city only as a time reference ("before I moved to Edinburgh, I was in Berlin from 2014 to 2016"), qwen re-extracts "lives in Edinburgh" as current, and that reopens the old city after the move. The engine handles the candidate it gets correctly; the gap is extraction. The fifth answered "April" without the year.

**C′** adds one rule to the shared extraction prompt (a clause that only places another fact in time isn't a new statement), which fixes three of the four. It isn't merged yet: it changes Gemini's prompt too, so it lands only after the Gemini goldens are re-recorded and row A shows no regression (ledger row 43).

**Reliability (row C).** 514 structured calls: 9% needed a repair round and 2% still failed. A failed session pack is re-extracted turn by turn, and a failed turn adds no facts. No reply hit the 4,096-token cap and no turn was cut before embedding. Store health: 0% ad-hoc predicates, 2% duplicate entities (row A: 0%).

**Time.** Ingesting dev-long cold generated 303k output tokens, about 2.9 hours at 29 tokens/s: roughly 4–5 minutes of background work per 37-turn history. Recall's model cost is one local query embedding: p50 44 ms and p95 117 ms when idle, and p50 47 ms and p95 264 ms while extraction runs on the same GPU (`bench/spikes/recall-latency.ts`).
