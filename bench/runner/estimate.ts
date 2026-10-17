// A pre-run estimate of LLM calls and tokens (SPEC §13.3), printed before a
// run starts. Items sharing a persona replay identical turns, which the cache
// answers once, so extraction is counted per unique turn.
import type { BenchItem } from '../dataset/schema.js';
import type { Mode } from './modes.js';

export interface Estimate {
  extractionCalls: number;
  /** Upper bound: one per unique session; low-importance sessions skip the call. */
  summarizeCalls: number;
  composeCalls: number;
  judgeCalls: number;
  promptTokens: number;
}

const tokens = (chars: number) => Math.ceil(chars / 4);

export function estimate(
  items: readonly BenchItem[],
  modes: readonly Mode[],
  llmJudge: boolean,
): Estimate {
  const uniqueTurns = new Set<string>();
  const uniqueSessions = new Set<string>();
  let composeChars = 0;
  for (const item of items) {
    const turns = item.setup_sessions.flatMap((s) =>
      s.turns.map((t, i) => `${s.session_id}#${i}:${t}`),
    );
    const historyChars = turns.reduce((n, t) => n + t.length, 0);
    for (const mode of modes) {
      if (mode === 'engram' || mode === 'engram_consolidated') {
        turns.forEach((t) => uniqueTurns.add(t));
      }
      if (mode === 'engram_consolidated') {
        for (const s of item.setup_sessions)
          uniqueSessions.add(`${s.session_id}:${s.turns.join('|')}`);
      }
      // The composer sees the whole history (full_context), a window (buffer), or a handful of memories.
      composeChars += 1200 + (mode === 'full_context' || mode === 'buffer' ? historyChars : 1500);
    }
  }
  const extractionCalls = uniqueTurns.size;
  return {
    extractionCalls,
    summarizeCalls: uniqueSessions.size,
    composeCalls: items.length * modes.length,
    judgeCalls: llmJudge ? items.filter((i) => i.judge === 'llm').length * modes.length : 0,
    promptTokens: tokens(composeChars) + extractionCalls * 900 + uniqueSessions.size * 1500,
  };
}

export function describeEstimate(e: Estimate, geminiRpm: number): string {
  const geminiCalls = e.extractionCalls + e.summarizeCalls + e.composeCalls;
  const minutes = Math.ceil(geminiCalls / geminiRpm);
  return [
    `Estimate (before cache hits): ${geminiCalls} Gemini calls (${e.extractionCalls} extraction, ${e.summarizeCalls > 0 ? `≤${e.summarizeCalls} summarize, ` : ''}${e.composeCalls} compose),`,
    `${e.judgeCalls} judge calls, ~${Math.round(e.promptTokens / 1000)}k prompt tokens; ~${minutes} min at ${geminiRpm} RPM.`,
  ].join(' ');
}
