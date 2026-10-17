// Filler sessions for the long-history dev split (P05): requests and small
// talk with no personal facts, interleaved with the persona's fact sessions so
// histories outgrow the buffer window and retrieval has to search. Registry-
// blind like the rest of the dataset code.
import { z } from 'zod';
import type { Persona } from './personas.js';
import { rng, sample } from './personas.js';
import type { Verbalizer } from './verbalize.js';

export const FILLER_SESSIONS = 8;

const TOPICS = [
  'how to fix a squeaky door hinge',
  'drafting a polite email that declines a meeting invitation',
  'the difference between baking soda and baking powder',
  'tips for keeping houseplants alive in winter',
  'how compound interest works',
  'a short beginner stretching routine',
  'how to remove a red wine stain from a carpet',
  'what makes a strong password',
  'ideas for a rainy-day board game night',
  'how noise-cancelling headphones work',
  'how to set up a simple monthly budget spreadsheet',
  'tips for sleeping better',
  'the rule for castling in chess',
  'how to write a good cover letter opening line',
  'why the sky looks blue',
];

/** Phrases that would turn filler into a personal fact. */
const PERSONAL = [
  'i live',
  'i work',
  'i moved',
  'my job',
  'my sister',
  'my partner',
  'my brother',
  'my mother',
  'my dog',
  'my cat',
  'my pet',
  "i'm allergic",
  'i am allergic',
  'my favourite',
  'my favorite',
];

export interface FillerPlan {
  sessionId: string;
  occurredAt: Date;
  topic: string;
}

const DAY = 86_400_000;

/**
 * Filler sessions spread across the persona's history: two before the first
 * session (so single-session items get noise too) and the rest between later
 * sessions, all before the questions are asked.
 */
export function fillerPlans(
  p: Persona,
  seed: number,
  askedAt: Date,
  count = FILLER_SESSIONS,
): FillerPlan[] {
  const random = rng(seed * 7919 + Number(p.id.slice(1)));
  const topics = sample(random, TOPICS, count);
  const times = p.sessions.map((s) => s.occurredAt.getTime());
  const first = times[0] ?? askedAt.getTime();
  const gaps: [number, number][] = [[first - 10 * DAY, first - DAY]];
  for (let i = 0; i + 1 < times.length; i++)
    gaps.push([(times[i] ?? 0) + DAY, (times[i + 1] ?? 0) - DAY]);
  gaps.push([(times.at(-1) ?? 0) + DAY, askedAt.getTime() - DAY]);
  return topics.map((topic, i) => {
    // Two sessions in the first gap, the rest round-robin over the others.
    const gap = i < 2 ? gaps[0] : gaps[1 + ((i - 2) % (gaps.length - 1))];
    const [lo, hi] = gap ?? [first, first];
    const at = new Date(lo + Math.floor(random() * Math.max(1, hi - lo)));
    at.setUTCHours(18 + (i % 4), 0, 0, 0);
    return { sessionId: `${p.id}-f${i + 1}`, occurredAt: at, topic };
  });
}

/** Every surface string of the persona: filler must not mention any of them. */
export function personaStrings(p: Persona): string[] {
  return [
    p.name,
    p.sister.name,
    p.sister.city,
    p.partner.name,
    p.partner.employer,
    p.pet.name,
    p.pet.species,
    p.allergy,
    p.instrument,
    p.food,
    p.language,
    ...p.homes.map((h) => h.city),
    ...p.jobs.flatMap((j) => [j.employer, j.title]),
    ...p.neverMentions.flatMap((n) => n.forbid),
  ];
}

/** Each turn is one ordinary message: no packed transcripts, no stray markup. */
export function checkShape(turns: readonly string[]): string[] {
  const problems: string[] = [];
  for (const t of turns) {
    const words = t.trim().split(/\s+/).length;
    if (/^\s*>/.test(t) || /\s>\s/.test(t)) problems.push('packs several messages into one turn');
    if (!/[a-z]{2,}\s+[a-z]{2,}/i.test(t) || /^[\w-]+_[\w-]+$/.test(t.trim()))
      problems.push(`"${t}" is not a message`);
    if (words > 60) problems.push('a turn is too long');
  }
  return problems;
}

export function checkFiller(turns: readonly string[], forbid: readonly string[]): string[] {
  const text = turns.join('\n').toLowerCase();
  const problems: string[] = checkShape(turns);
  for (const word of forbid) {
    const re = new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(text)) problems.push(`mentions "${word}"`);
  }
  for (const phrase of PERSONAL)
    if (text.includes(phrase)) problems.push(`personal fact ("${phrase}")`);
  return problems;
}

const Turns = z.object({ turns: z.array(z.string().min(1)).min(2).max(4) });

const SYSTEM = `You write what a person types to their AI assistant in one short chat about an everyday request. Reply with JSON only, matching the schema.

Write 3 short messages from the user, in the first person, about the given topic: a request, a follow-up, a thank-you or reaction. Say nothing about the user's own life: no names, places, family, partner, pets, job, home, health, preferences or dates. Only the user's side; no assistant replies.`;

export async function verbalizeFiller(
  llm: Verbalizer,
  plan: FillerPlan,
  forbid: readonly string[],
  attempts = 3,
): Promise<string[]> {
  let feedback = '';
  for (let i = 0; i < attempts; i++) {
    const { turns } = await llm.generate({
      system: SYSTEM,
      user: [`Topic: ${plan.topic}`, `Never mention: ${forbid.join(', ')}`, feedback]
        .filter(Boolean)
        .join('\n\n'),
      schema: Turns,
      schemaName: 'filler_turns',
      temperature: 0.7,
    });
    const problems = checkFiller(turns, forbid);
    if (problems.length === 0) return turns;
    feedback = `Your previous attempt had problems: ${problems.join('; ')}. Remove them.`;
  }
  throw new Error(
    `Couldn't write filler ${plan.sessionId} after ${attempts} attempts: ${feedback}`,
  );
}
