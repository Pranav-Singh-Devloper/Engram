// The chapters of /architecture, in reading order (P09c scope). A chapter is
// listed only once it's built: no placeholder chapters are ever published.
import type { ReactNode } from 'react';
import { Bitemporal } from './chapters/bitemporal';
import { DecisionLog } from './chapters/decision-log';
import { Overview } from './chapters/overview';
import { References } from './chapters/references';
import { Versions } from './chapters/versions';
import { WritePath } from './chapters/write-path';

export interface ChapterDef {
  id: string;
  n: number;
  title: string;
  kicker: string;
  body: () => ReactNode;
}

/** Chapter ids, for links that should only appear once their target is published. */
const PUBLISHED = new Set([
  'overview',
  'write-path',
  'bitemporal',
  'versions',
  'decisions',
  'references',
]);

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'overview',
    n: 1,
    title: 'The whole system, moving',
    kicker: 'Overview',
    body: () => <Overview published={PUBLISHED} />,
  },
  {
    id: 'write-path',
    n: 2,
    title: 'What happens to one sentence',
    kicker: 'The write path',
    body: () => <WritePath />,
  },
  {
    id: 'bitemporal',
    n: 3,
    title: 'Two kinds of time',
    kicker: 'Bitemporal model',
    body: () => <Bitemporal />,
  },
  {
    id: 'versions',
    n: 4,
    title: 'Nothing is overwritten',
    kicker: 'Fact versions',
    body: () => <Versions />,
  },
  {
    id: 'decisions',
    n: 15,
    title: 'Every decision, with its alternatives',
    kicker: 'Decision log',
    body: () => <DecisionLog />,
  },
  {
    id: 'references',
    n: 16,
    title: 'References',
    kicker: 'Bibliography',
    body: () => <References />,
  },
];
