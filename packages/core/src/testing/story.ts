// The bitemporal story (P03): a short life told out of order, with the
// questions the bitemporal model exists to answer. Shared by
// `pnpm demo:offline` and the architecture explorer (P09c), so both show
// exactly the same history.
import { aboutSelf, hint } from './scenario.js';
import type { Turn } from './scenario.js';

export const STORY_TURNS: (Turn & { note?: string })[] = [
  {
    at: '2024-01-15T09:00:00Z',
    content: 'I live in Paris.',
    candidates: [aboutSelf('lives_in', 'Paris')],
  },
  {
    at: '2024-06-10T09:00:00Z',
    content: 'I moved to Berlin in March.',
    candidates: [aboutSelf('lives_in', 'Berlin', { from: hint.month(3) })],
    note: 'update: Paris closes at 2024-03-01',
  },
  {
    at: '2024-07-01T09:00:00Z',
    content: 'I work at Initech.',
    candidates: [aboutSelf('works_at', 'Initech', { type: 'org' })],
  },
  {
    at: '2024-07-02T09:00:00Z',
    content: 'Actually, I work at Acme, not Initech.',
    candidates: [aboutSelf('works_at', 'Acme', { type: 'org', correction: true })],
    note: 'correction: Initech retracted',
  },
  {
    at: '2024-08-01T09:00:00Z',
    content: 'Before Paris I lived in Lyon, 2015 to 2018.',
    candidates: [aboutSelf('lives_in', 'Lyon', { from: hint.year(2015), to: hint.year(2018) })],
    note: 'backfill: older history learned later',
  },
  {
    at: '2024-08-01T09:05:00Z',
    content: 'And before that, Marseille.',
    candidates: [aboutSelf('lives_in', 'Marseille', { to: hint.year(2015) })],
    note: 'backfill with an unknown start',
  },
];

export const STORY_NOW = '2024-09-01T00:00:00Z';

export interface StoryQuestion {
  ask: string;
  predicate: string;
  validAt?: string;
  knownAt?: string;
  expected: string[];
}

export const STORY_QUESTIONS: StoryQuestion[] = [
  { ask: 'Where does the user live now?', predicate: 'lives_in', expected: ['Berlin'] },
  {
    ask: 'Where did they live on 2024-02-01?',
    predicate: 'lives_in',
    validAt: '2024-02-01',
    expected: ['Paris'],
  },
  {
    ask: 'On 2024-05-01, where did we think they lived?',
    predicate: 'lives_in',
    validAt: '2024-05-01',
    knownAt: '2024-05-01',
    expected: ['Paris'],
  },
  {
    ask: 'Knowing what we know now, where were they on 2024-05-01?',
    predicate: 'lives_in',
    validAt: '2024-05-01',
    expected: ['Berlin'],
  },
  {
    ask: 'Where did they live in 2016?',
    predicate: 'lives_in',
    validAt: '2016-06-01',
    expected: ['Lyon'],
  },
  {
    ask: 'In July, what did we know about 2016?',
    predicate: 'lives_in',
    validAt: '2016-06-01',
    knownAt: '2024-07-15',
    expected: [],
  },
  {
    ask: 'Where did they live in 2010?',
    predicate: 'lives_in',
    validAt: '2010-01-01',
    expected: ['Marseille'],
  },
  { ask: 'Where do they work now?', predicate: 'works_at', expected: ['Acme'] },
  {
    ask: 'Just before the correction, where did we think they worked?',
    predicate: 'works_at',
    knownAt: '2024-07-01T12:00:00Z',
    validAt: '2024-07-01T12:00:00Z',
    expected: ['Initech'],
  },
  {
    ask: 'Knowing what we know now, where did they work on 1 July?',
    predicate: 'works_at',
    validAt: '2024-07-01T12:00:00Z',
    expected: ['Acme'],
  },
];
