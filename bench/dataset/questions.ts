// Questions and exact expected answers, derived from a persona's timeline.
import type { Category, JudgeKind } from './schema.js';
import { believedHomeAt, employerAt, homeAt, monthName } from './personas.js';
import type { Persona } from './personas.js';

export const ABSTAIN = "I don't know";

export interface DraftItem {
  category: Category;
  question: string;
  askedAt: Date;
  validAt: Date | null;
  knownAt: Date | null;
  expected: string;
  judge: JudgeKind;
  notes: string;
  /** `first`: only the first session is replayed (single-session items). */
  sessions: 'all' | 'first';
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`missing index ${i}`);
  return v;
}

/** Every question the persona supports, grouped by category. */
export function questionsFor(p: Persona): DraftItem[] {
  const last = at(p.sessions, p.sessions.length - 1).occurredAt;
  const first = at(p.sessions, 0).occurredAt;
  const askedAt = addDays(last, 7);
  const [oldHome, home1, home2] = [at(p.homes, 0), at(p.homes, 1), at(p.homes, 2)];
  const moveDate = home2.from ?? last;
  const learnedMove = home2.saidAt;
  const items: DraftItem[] = [];
  const add = (
    d: Omit<DraftItem, 'askedAt' | 'validAt' | 'knownAt' | 'sessions'> & Partial<DraftItem>,
  ) => items.push({ askedAt, validAt: null, knownAt: null, sessions: 'all', ...d });

  // Cross-session recall: said in session 1 or 2, asked after session 4.
  add({
    category: 'cross_session_recall',
    question: `What's my ${p.pet.species} called?`,
    expected: p.pet.name,
    judge: 'contains',
    notes: 'pet named in session 1, restated in session 3',
  });
  add({
    category: 'cross_session_recall',
    question: 'Remind me, what am I allergic to?',
    expected: p.allergy,
    judge: 'contains',
    notes: 'allergy from session 2',
  });
  add({
    category: 'cross_session_recall',
    question: 'Which instrument do I play?',
    expected: p.instrument,
    judge: 'contains',
    notes: 'instrument from session 2',
  });
  add({
    category: 'cross_session_recall',
    question: "What's my sister's name?",
    expected: p.sister.name,
    judge: 'contains',
    notes: 'sister from session 1',
  });
  add({
    category: 'cross_session_recall',
    question: "What's my favourite food?",
    expected: p.food,
    judge: 'contains',
    notes: 'food from session 2',
  });

  // Knowledge updates: the current value after a change.
  add({
    category: 'knowledge_update',
    question: 'Which city do I live in now?',
    expected: home2.city,
    judge: 'contains',
    notes: `${p.moveStyle} move from ${home1.city} in session 3`,
  });
  const employer = employerAt(p, askedAt) ?? '';
  if (p.jobs.length > 1) {
    add({
      category: 'knowledge_update',
      question: 'Where do I work these days?',
      expected: employer,
      judge: 'contains',
      notes: `job change from ${at(p.jobs, 0).employer} in session 3`,
    });
  }

  // Temporal reasoning: valid time, record time, out-of-order history.
  const midHome1 = new Date((first.getTime() + moveDate.getTime()) / 2);
  add({
    category: 'temporal_reasoning',
    question: `Where was I living in ${monthName(midHome1)}?`,
    validAt: midHome1,
    expected: homeAt(p, midHome1) ?? '',
    judge: 'contains',
    notes: 'valid time between the first session and the move',
  });
  add({
    category: 'temporal_reasoning',
    question: `Where did I live before ${home1.city}?`,
    expected: oldHome.city,
    judge: 'contains',
    notes: 'history told out of order in session 4',
  });
  const knownAt = addDays(learnedMove, -2);
  add({
    category: 'temporal_reasoning',
    question: `Going only on what I'd told you by ${longDate(knownAt)}, which city did you think I lived in then?`,
    validAt: knownAt,
    knownAt,
    expected: believedHomeAt(p, knownAt, knownAt) ?? '',
    judge: 'contains',
    notes: 'record time: the move had happened but was not yet said',
  });
  const oldYear = (oldHome.from?.getUTCFullYear() ?? 2015) + 1;
  const inOld = new Date(Date.UTC(oldYear, 5, 15));
  add({
    category: 'temporal_reasoning',
    question: `Which city was I living in during ${oldYear}?`,
    validAt: inOld,
    expected: homeAt(p, inOld) ?? '',
    judge: 'contains',
    notes: 'valid time inside history learned last',
  });
  add({
    category: 'temporal_reasoning',
    question: `When did I move to ${home2.city}?`,
    expected: monthName(moveDate),
    judge: 'llm',
    notes: `${p.moveStyle} move; month and year`,
  });

  // Single-session recall: only the first session is replayed.
  const single = { askedAt: addDays(first, 1), sessions: 'first' as const };
  add({
    ...single,
    category: 'single_session_recall',
    question: 'What do I do for work?',
    expected: at(p.jobs, 0).title,
    judge: 'contains',
    notes: 'job title, session 1 only',
  });
  add({
    ...single,
    category: 'single_session_recall',
    question: 'Which city do I live in?',
    expected: home1.city,
    judge: 'contains',
    notes: 'home, session 1 only',
  });
  add({
    ...single,
    category: 'single_session_recall',
    question: "What's my pet's name?",
    expected: p.pet.name,
    judge: 'contains',
    notes: 'pet, session 1 only',
  });

  // Multi-hop: a fact about someone else, reached through the relationship.
  add({
    category: 'multi_hop',
    question: 'Which city does my sister live in?',
    expected: p.sister.city,
    judge: 'contains',
    notes: 'user → sister → city',
  });
  add({
    category: 'multi_hop',
    question: 'Where does my partner work?',
    expected: p.partner.employer,
    judge: 'contains',
    notes: 'user → partner → employer',
  });

  // Abstention: never mentioned.
  for (const absent of p.neverMentions) {
    add({
      category: 'abstention',
      question: absent.question,
      expected: ABSTAIN,
      judge: 'exact',
      notes: 'never mentioned',
    });
  }
  return items;
}
