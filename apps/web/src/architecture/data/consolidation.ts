// One dev-long history consolidated by the engine (bench explorer:data), and
// the test split's totals. The skip rule mirrors core consolidate.ts.
import raw from '@/content/generated/consolidation.json';

export interface StorySession {
  id: string;
  filler: boolean;
  occurredAt: string;
  turns: { content: string; importance: number }[];
  maxImportance: number;
  summary: string | null;
  facts: { statement: string; tier: string; current: boolean }[];
}

export const CONSOLIDATION = raw as {
  testSplit: {
    run: string;
    items: number;
    summarizedPerItem: number;
    skippedPerItem: number;
    longTermPerItem: number;
    outcomes: Record<string, number>;
    inserted: string[];
  };
  item: string;
  question: string;
  expected: string;
  answer: string;
  consolidation: {
    summarized: number;
    skipped: number;
    promoted: number;
    longTermFacts: number;
    outcomes: Record<string, number>;
  };
  sessions: StorySession[];
};

/** core config.consolidation (parity test). */
export const CONSOLIDATION_CONFIG = {
  maxClusterSize: 12,
  driftThreshold: 0.5,
  minImportance: 0.3,
  maxClustersPerRun: 20,
};

/** A cluster whose turns all score below minImportance is marked done without a model call. */
export const skips = (s: Pick<StorySession, 'maxImportance'>, minImportance: number) =>
  s.maxImportance < minImportance;

/** Inserted test-split facts read as weak inferences (ledger row 28, docs/benchmarks.md). */
export const WEAK_INFERENCES = [
  'The user visited Melbourne.',
  'The user visited Nairobi.',
  'Olive likes Porto.',
];
