// A pre-run estimate of LLM calls, tokens and embedded texts (SPEC §13.3),
// printed before a run starts. Items sharing a persona replay identical turns,
// which the cache answers once, so extraction is counted per unique turn.
// Gemini's free embedding quota counts texts, not requests (ADR-018), and the
// bench caches vectors per text, so embedding is counted per unique text.
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
  /** Unique texts embedded, known exactly: turns, query texts, summaries (upper bound). */
  embedTexts: number;
  /** Facts and entity labels extraction will embed: estimated, EXTRACTED_TEXTS_PER_TURN per turn. */
  extractedTexts: number;
}

/**
 * Facts plus entity labels embedded per turn of history, measured: 0.56 on
 * the test split, 0.75 on dev-long (runs 2026-10-18-test and
 * 2026-10-18-devlong-session). The higher one, so the estimate errs high.
 */
export const EXTRACTED_TEXTS_PER_TURN = 0.75;

/** Gemini's free embedding quota per key and day, in texts (measured, ADR-018). */
export const FREE_EMBED_TEXTS_PER_KEY_DAY = 1000;

const tokens = (chars: number) => Math.ceil(chars / 4);

export function estimate(
  items: readonly BenchItem[],
  modes: readonly Mode[],
  llmJudge: boolean,
  extraction: Extraction = 'turn',
): Estimate {
  const uniqueTurns = new Set<string>();
  const uniqueExtractSessions = new Map<string, number>();
  const packedHistories = new Map<string, number>();
  const uniqueSessions = new Set<string>();
  let composeChars = 0;
  // Embedding: turn texts (documents), query texts, and histories engram extracts from.
  const embeddedTurns = new Set<string>();
  const queries = new Set<string>();
  const extractedHistories = new Map<string, number>();
  for (const item of items) {
    const turns = item.setup_sessions.flatMap((s) =>
      s.turns.map((t, i) => `${s.session_id}#${i}:${t}`),
    );
    const historyChars = turns.reduce((n, t) => n + t.length, 0);
    for (const mode of modes) {
      if (mode === 'rag' || mode === 'engram' || mode === 'engram_consolidated') {
        for (const s of item.setup_sessions) s.turns.forEach((t) => embeddedTurns.add(t));
        queries.add(item.question);
      }
      if (mode === 'engram' || mode === 'engram_consolidated') {
        extractedHistories.set(turns.join('\n'), turns.length);
        turns.forEach((t) => uniqueTurns.add(t));
        for (const s of item.setup_sessions) {
          uniqueExtractSessions.set(
            `${s.session_id}:${s.turns.join('|')}`,
            s.turns.reduce((n, t) => n + t.length, 0),
          );
        }
        // Packs depend on the whole history, so identical histories share them.
        packedHistories.set(turns.join('\n'), historyChars);
      }
      if (mode === 'engram_consolidated') {
        for (const s of item.setup_sessions)
          uniqueSessions.add(`${s.session_id}:${s.turns.join('|')}`);
      }
      // The composer sees the whole history (full_context), a window (buffer), or a handful of memories.
      composeChars += 1200 + (mode === 'full_context' || mode === 'buffer' ? historyChars : 1500);
    }
  }
  const packs = (chars: number) => Math.max(1, Math.ceil(chars / 4 / PACK_TOKENS));
  const extractionCalls =
    extraction === 'turn'
      ? uniqueTurns.size
      : extraction === 'session'
        ? uniqueExtractSessions.size
        : [...packedHistories.values()].reduce((n, chars) => n + packs(chars), 0);
  // Batched calls carry their turns' text plus ~1,500 tokens of instructions each.
  const batchedChars = [
    ...(extraction === 'session' ? uniqueExtractSessions.values() : packedHistories.values()),
  ].reduce((n, c) => n + c, 0);
  const extractionTokens =
    extraction === 'turn' ? extractionCalls * 900 : tokens(batchedChars) + extractionCalls * 1500;
  return {
    extractionCalls,
    summarizeCalls: uniqueSessions.size,
    composeCalls: items.length * modes.length,
    judgeCalls: llmJudge ? items.filter((i) => i.judge === 'llm').length * modes.length : 0,
    promptTokens: tokens(composeChars) + extractionTokens + uniqueSessions.size * 1500,
    embedTexts: embeddedTurns.size + queries.size + uniqueSessions.size,
    extractedTexts: Math.ceil(
      [...extractedHistories.values()].reduce((n, t) => n + t, 0) * EXTRACTED_TEXTS_PER_TURN,
    ),
  };
}

export function describeEstimate(e: Estimate, geminiRpm: number): string {
  const geminiCalls = e.extractionCalls + e.summarizeCalls + e.composeCalls;
  const minutes = Math.ceil(geminiCalls / geminiRpm);
  return [
    `Estimate (before cache hits): ${geminiCalls} Gemini calls (${e.extractionCalls} extraction, ${e.summarizeCalls > 0 ? `≤${e.summarizeCalls} summarize, ` : ''}${e.composeCalls} compose),`,
    `${e.judgeCalls} judge calls, ~${Math.round(e.promptTokens / 1000)}k prompt tokens; ~${minutes} min at ${geminiRpm} RPM.`,
    `Embedding: ${(e.embedTexts + e.extractedTexts).toLocaleString('en')} texts embedded (${e.embedTexts.toLocaleString('en')} turns, queries and summaries, plus ~${e.extractedTexts.toLocaleString('en')} extracted facts and labels), ~${Math.ceil((e.embedTexts + e.extractedTexts) / FREE_EMBED_TEXTS_PER_KEY_DAY)} key-days at ${FREE_EMBED_TEXTS_PER_KEY_DAY.toLocaleString('en')} texts per key a day (Gemini embeddings; before cache hits).`,
  ].join(' ');
}
