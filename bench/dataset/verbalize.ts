// Turns a session's planned statements into what the user would actually type
// (P04 design decision 1). The ground truth stays in code; the model only
// chooses words. Every reply is checked: required strings present, forbidden
// topics absent, and implicit updates kept implicit.
import { z } from 'zod';
import type { GroqRequest } from '@engram/core';
import type { SessionPlan } from './personas.js';

export const VERBALIZER_MODEL = 'qwen/qwen3.8-27b';

/** Anything with GroqProvider's `generate`. */
export interface Verbalizer {
  generate<T>(request: GroqRequest<T>): Promise<T>;
}

const Turns = z.object({ turns: z.array(z.string().min(1)).min(1).max(6) });

const SYSTEM = `You write what a person types to their personal AI assistant during one chat session. Reply with JSON only, matching the schema.

Write 2 to 4 short, casual messages from the user, in the first person, that together convey every point you are given. State each point plainly as something true about you, never as a question or a guess, and keep its exact meaning ("allergic" stays allergic, "lives in" stays living there). Use your own words, but copy every exact string you are given (names, places, dates, numbers) verbatim. Don't add any other personal facts: no other people, places, jobs, pets, dates or events. Only the user's side; no assistant replies.`;

const wordRe = (word: string) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

/** Problems with a set of turns, or an empty list when they're usable. */
export function checkTurns(
  turns: readonly string[],
  plan: SessionPlan,
  forbid: readonly string[],
): string[] {
  const text = turns.join('\n');
  const problems: string[] = [];
  for (const s of plan.statements) {
    for (const needed of s.mustInclude) {
      if (!text.toLowerCase().includes(needed.toLowerCase())) problems.push(`missing "${needed}"`);
    }
    if (s.style === 'implicit' && /\bmov(e|ed|ing)\b/i.test(text))
      problems.push('says "moved"; keep the move implicit');
  }
  for (const word of forbid) {
    if (wordRe(word).test(text)) problems.push(`mentions "${word}", which must not come up`);
  }
  return problems;
}

export async function verbalizeSession(
  llm: Verbalizer,
  persona: string,
  plan: SessionPlan,
  forbid: readonly string[],
  attempts = 3,
): Promise<string[]> {
  const points = plan.statements.map((s) => `- ${s.says}`).join('\n');
  const exact = [...new Set(plan.statements.flatMap((s) => s.mustInclude))]
    .map((x) => `"${x}"`)
    .join(', ');
  let feedback = '';
  for (let i = 0; i < attempts; i++) {
    const { turns } = await llm.generate({
      system: SYSTEM,
      user: [
        `You are ${persona}. Points to convey:\n${points}`,
        `Exact strings that must appear: ${exact}`,
        `Never mention: ${forbid.join(', ')}`,
        feedback,
      ]
        .filter(Boolean)
        .join('\n\n'),
      schema: Turns,
      schemaName: 'user_turns',
      temperature: 0.7,
    });
    const problems = checkTurns(turns, plan, forbid);
    if (problems.length === 0) return turns;
    feedback = `Your previous attempt had problems: ${problems.join('; ')}. Fix them.`;
  }
  throw new Error(`Couldn't verbalize ${plan.sessionId} after ${attempts} attempts: ${feedback}`);
}
