// A pre-run estimate of LLM calls and tokens (SPEC §13.3), printed before a
// run starts. Items sharing a persona replay identical turns, which the cache
// answers once, so extraction is counted per unique turn.
import type { BenchItem } from '../dataset/schema.js';
import { PACK_TOKENS } from './modes.js';
import type { Extraction, Mode } from './modes.js';

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
  extraction: Extraction = 'turn',
): Estimate {
  const uniqueTurns = new Set<string>();
  const uniqueExtractSessions = new Set<string>();
  const packedHistories = new Map<string, number>();
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
        for (const s of item.setup_sessions) {
          uniqueExtractSessions.add(`${s.session_id}:${s.turns.join('|')}`);
        }
        // Packs depend on the whole history, so identical histories share them.
        packedHistories.set(
          turns.join('\n'),
          Math.max(1, Math.ceil(historyChars / 4 / PACK_TOKENS)),
        );
      }
      if (mode === 'engram_consolidated') {
        for (const s of item.setup_sessions)
          uniqueSessions.add(`${s.session_id}:${s.turns.join('|')}`);
      }
      // The composer sees the whole history (full_context), a window (buffer), or a handful of memories.
      composeChars += 1200 + (mode === 'full_context' || mode === 'buffer' ? historyChars : 1500);
    }
  }
  const extractionCalls =
    extraction === 'turn'
      ? uniqueTurns.size
      : extraction === 'session'
        ? uniqueExtractSessions.size
        : [...packedHistories.values()].reduce((n, k) => n + k, 0);
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
