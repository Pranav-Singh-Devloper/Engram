// The chapters of /architecture, in reading order (P09c scope). A chapter is
// listed only once it's built: no placeholder chapters are ever published.
import type { ReactNode } from 'react';
import { DecisionLog } from './chapters/decision-log';
import { References } from './chapters/references';

export interface ChapterDef {
  id: string;
  n: number;
  title: string;
  kicker: string;
  body: () => ReactNode;
}

export const CHAPTERS: ChapterDef[] = [
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
