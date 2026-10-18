// P08b decision 1: is grammar-constrained decoding (llama.cpp's server) better
// than Ollama with the JSON schema in the prompt, for qwen3.5:9b?
//   tsx spikes/transport.ts ollama
//   tsx spikes/transport.ts llamacpp http://127.0.0.1:8091
// Runs the 10 golden fixture conversations (per-turn and per-session
// extraction) and prints time, output tokens, repairs, failures, capped
// replies, and how many of Gemini's golden facts each recovers.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FakeProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  PREDICATE_NAMES,
} from '@engram/core';
import type { FactCandidate } from '@engram/core';

const transport = process.argv[2] ?? 'ollama';
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const tag = [transport, arg('presence') && `p${arg('presence')}`, arg('cap') && `cap${arg('cap')}`]
  .filter(Boolean)
  .join('-');
const fixtures = path.resolve(import.meta.dirname, '../../packages/core/fixtures');
const embedder = new FakeProvider();
const p =
  transport === 'llamacpp'
    ? new OpenAICompatibleProvider({
        baseUrl: process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8091',
        model: 'qwen3.5-9b',
        embedder,
        maxTokens: 4096,
        extra: { chat_template_kwargs: { enable_thinking: false } },
      })
    : new OllamaProvider({
        embedder,
        ...(arg('presence') !== undefined && { presencePenalty: Number(arg('presence')) }),
        ...(arg('cap') !== undefined && { maxTokens: Number(arg('cap')) }),
      });

interface Conversation {
  id: string;
  episodes: { role: string; content: string; occurredAt: string }[];
}
interface Expected {
  facts: { fact: string }[];
}

const label = (c: FactCandidate) => {
  const o = c.object.kind === 'entity' ? c.object.entity.name : c.object.value;
  return `${c.predicate} ${o}`.toLowerCase();
};

const rows: Record<string, unknown>[] = [];
let goldTotal = 0;
let goldFound = 0;
const t0 = Date.now();
for (const file of readdirSync(path.join(fixtures, 'conversations')).sort()) {
  const conv = JSON.parse(
    readFileSync(path.join(fixtures, 'conversations', file), 'utf8'),
  ) as Conversation;
  const expected = JSON.parse(
    readFileSync(path.join(fixtures, 'expected', file), 'utf8'),
  ) as Expected;
  const found: string[] = [];
  const tc = Date.now();
  for (const e of conv.episodes) {
    try {
      const out = await p.processEpisode({
        content: e.content,
        role: e.role as 'user',
        occurredAt: new Date(e.occurredAt),
        predicates: [...PREDICATE_NAMES],
      });
      found.push(...out.candidates.map(label));
    } catch (err) {
      rows.push({ conv: conv.id, error: String(err).slice(0, 120) });
    }
  }
  const turnMs = Date.now() - tc;
  const ts = Date.now();
  let sessionCandidates = 0;
  try {
    const out = await p.extractSessions({
      turns: conv.episodes.map((e, i) => ({
        id: `t${i}`,
        sessionId: 's1',
        role: e.role as 'user',
        content: e.content,
        occurredAt: new Date(e.occurredAt),
      })),
      predicates: [...PREDICATE_NAMES],
    });
    sessionCandidates = out.candidates.length;
  } catch (err) {
    rows.push({ conv: conv.id, sessionError: String(err).slice(0, 120) });
  }
  // Gemini's golden facts, as "predicate object": brackets stripped, predicate = first registry or snake_case token.
  const gold = expected.facts.map((f) => {
    const tokens = f.fact
      .replace(/\s*\[.*?\]/g, '')
      .replace(/"/g, '')
      .split(/\s+/);
    const at = tokens.findIndex((t) => PREDICATE_NAMES.includes(t) || /^[a-z]+(_[a-z]+)+$/.test(t));
    return tokens.slice(at).join(' ').toLowerCase();
  });
  const hit = gold.filter((g) =>
    found.some((f) => f === g || f.endsWith(g.split(' ').slice(1).join(' '))),
  ).length;
  goldTotal += gold.length;
  goldFound += hit;
  rows.push({
    conv: conv.id,
    turns: conv.episodes.length,
    turnMs,
    sessionMs: Date.now() - ts,
    candidates: found.length,
    sessionCandidates,
    gold: gold.length,
    goldFound: hit,
  });
  console.log(JSON.stringify(rows.at(-1)));
}
const stats = p.structuredStats;
const summary = {
  transport: tag,
  wallSeconds: Math.round((Date.now() - t0) / 1000),
  structuredCalls: stats.calls,
  repairs: stats.repairs,
  failures: stats.failures,
  outputTokens: p.outputTokens,
  capped: p.capped,
  goldRecall: `${goldFound}/${goldTotal}`,
};
console.log(JSON.stringify(summary));
writeFileSync(
  path.resolve(import.meta.dirname, `transport-${transport}.json`),
  `${JSON.stringify({ summary, rows }, null, 2)}\n`,
);
