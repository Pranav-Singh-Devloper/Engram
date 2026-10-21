// The chapters of /architecture, in reading order (P09c scope). A chapter is
// listed only once it's built: no placeholder chapters are ever published.
import type { ReactNode } from 'react';
import { Benchmarks } from './chapters/benchmarks';
import { Bitemporal } from './chapters/bitemporal';
import { Consolidation } from './chapters/consolidation';
import { Decay } from './chapters/decay';
import { Galaxy } from './chapters/galaxy';
import { Interfaces } from './chapters/interfaces';
import { DecisionLog } from './chapters/decision-log';
import { Overview } from './chapters/overview';
import { Providers } from './chapters/providers';
import { Recall } from './chapters/recall';
import { References } from './chapters/references';
import { Resolution } from './chapters/resolution';
import { Storage } from './chapters/storage';
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
  'resolution',
  'recall',
  'decay',
  'consolidation',
  'galaxy',
  'storage',
  'providers',
  'interfaces',
  'benchmarks',
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
    id: 'resolution',
    n: 5,
    title: 'Is this the same Sam?',
    kicker: 'Entity resolution and similarity profiles',
    body: () => <Resolution />,
  },
  {
    id: 'recall',
    n: 6,
    title: 'Four searches, one ranking',
    kicker: 'Recall',
    body: () => <Recall />,
  },
  {
    id: 'decay',
    n: 7,
    title: 'Forgetting on purpose',
    kicker: 'Decay',
    body: () => <Decay />,
  },
  {
    id: 'consolidation',
    n: 8,
    title: 'Sleeping on it',
    kicker: 'Consolidation',
    body: () => <Consolidation />,
  },
  {
    id: 'galaxy',
    n: 9,
    title: 'Where meaning lives',
    kicker: 'The embedding galaxy',
    body: () => <Galaxy />,
  },
  {
    id: 'storage',
    n: 10,
    title: 'One database, two clocks',
    kicker: 'Storage',
    body: () => <Storage />,
  },
  {
    id: 'providers',
    n: 11,
    title: 'Any model, measured',
    kicker: 'Providers and local mode',
    body: () => <Providers />,
  },
  {
    id: 'interfaces',
    n: 12,
    title: 'How agents and people reach it',
    kicker: 'Interfaces',
    body: () => <Interfaces />,
  },
  {
    id: 'benchmarks',
    n: 13,
    title: 'Losses included',
    kicker: 'Benchmarks',
    body: () => <Benchmarks />,
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
