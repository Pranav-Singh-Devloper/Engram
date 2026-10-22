// Prior art (P09c chapter 14). Each cell was checked against the paper's own
// text on 2026-10-22, not recalled: "no" means the paper doesn't describe it.
// prior-art.test.ts keeps every system and timeline entry tied to the
// bibliography.

export const CAPABILITIES = [
  { key: 'valid', label: 'valid time', what: 'when a fact was true in the world' },
  { key: 'record', label: 'record time', what: 'what the system believed, and when' },
  {
    key: 'versions',
    label: 'versions kept',
    what: 'a change keeps the old belief instead of overwriting it',
  },
  { key: 'forgetting', label: 'forgetting', what: 'memories fade or are archived over time' },
  {
    key: 'consolidation',
    label: 'consolidation',
    what: 'episodes distilled into lasting knowledge',
  },
  { key: 'graph', label: 'entity graph', what: 'memories linked through entities' },
] as const;
export type Capability = (typeof CAPABILITIES)[number]['key'];
export type Level = 'yes' | 'partial' | 'no';

export interface System {
  ref: string;
  name: string;
  year: number;
  cells: Record<Capability, { level: Level; note: string }>;
  /** What Engram took from it. */
  adopted: string;
  /** Where Engram differs, and why. */
  differs: string;
  /** What it has that Engram lacks. */
  lacks: string;
  benchmarks: string;
}

const no = (note = 'not described') => ({ level: 'no' as const, note });

export const SYSTEMS: System[] = [
  {
    ref: 'packer2023',
    name: 'MemGPT',
    year: 2023,
    cells: {
      valid: no(),
      record: no(),
      versions: no('working context is edited in place; no prior values kept'),
      forgetting: no('evicted messages move to recall storage; nothing decays'),
      consolidation: {
        level: 'partial',
        note: 'a recursive summary of evicted messages heads the queue',
      },
      graph: no(),
    },
    adopted:
      'Tiered memory: a small working set in the prompt, everything else in storage, fetched on demand.',
    differs:
      'MemGPT’s agent pages its own memory through function calls. Engram is a service outside the agent: any MCP client gets the same memory, and writes go through the engine’s rules, not the model’s discretion.',
    lacks:
      'Self-directed memory management: an Engram agent can’t rewrite its own working context.',
    benchmarks: 'deep memory retrieval, multi-document QA, nested key-value retrieval',
  },
  {
    ref: 'park2023',
    name: 'Generative Agents',
    year: 2023,
    cells: {
      valid: no(),
      record: no('timestamps of creation and last retrieval only'),
      versions: {
        level: 'partial',
        note: 'an append-only stream: nothing overwritten, nothing marked superseded',
      },
      forgetting: {
        level: 'partial',
        note: 'recency decays 0.995 per game hour in the ranking; nothing is removed',
      },
      consolidation: {
        level: 'yes',
        note: 'reflections once recent importance passes 150, stored with evidence pointers',
      },
      graph: no(),
    },
    adopted: 'Recency, importance and relevance as memory signals; reflection as distillation.',
    differs:
      'There, the three signals are normalized and summed to rank retrieval. Engram ranks with RRF over lists and uses recency, access and importance to decide what to keep.',
    lacks:
      'Reflection trees: reflections that cite other reflections, building higher-level beliefs.',
    benchmarks: 'Believability interviews and ablations in a sandbox town',
  },
  {
    ref: 'zhong2024',
    name: 'MemoryBank',
    year: 2024,
    cells: {
      valid: no(),
      record: no(),
      versions: no('no handling of contradictions'),
      forgetting: {
        level: 'yes',
        note: 'Ebbinghaus R = e^(−t/S): recall raises S by 1 and resets t',
      },
      consolidation: {
        level: 'yes',
        note: 'daily event summaries, a global summary and a user portrait',
      },
      graph: no(),
    },
    adopted: 'Forgetting reinforced by recall: access raises a memory’s retention.',
    differs:
      'Engram’s retention score adds per-tier time constants, an archive threshold, exempt predicates and a proven invariant (archivable iff importance < 0.6). Archiving is reversible.',
    lacks: 'A user portrait: a running model of the user’s personality.',
    benchmarks: 'Simulated long-term dialogues (SiliconFriend)',
  },
  {
    ref: 'chhikara2025',
    name: 'Mem0',
    year: 2025,
    cells: {
      valid: no('no explicit validity intervals described'),
      record: {
        level: 'partial',
        note: 'Mem0^g marks conflicting relations invalid instead of deleting them',
      },
      versions: {
        level: 'partial',
        note: 'base Mem0 UPDATEs or DELETEs; the graph variant keeps invalidated relations',
      },
      forgetting: no('removal only on contradiction (DELETE)'),
      consolidation: {
        level: 'partial',
        note: 'extraction reads an asynchronously refreshed conversation summary',
      },
      graph: { level: 'yes', note: 'Mem0^g: entities and relations, with an LLM update resolver' },
    },
    adopted: 'Extract, then reconcile each candidate against similar existing memories.',
    differs:
      'Mem0 lets the model choose ADD, UPDATE, DELETE or NOOP. Engram decides most changes with rules and calls an adjudicator only for the rest, and never deletes: every version keeps its valid and record time.',
    lacks: 'Production scale and a hosted platform; Engram is one Postgres database on free tiers.',
    benchmarks: 'LoCoMo',
  },
  {
    ref: 'rasmussen2025',
    name: 'Zep / Graphiti',
    year: 2025,
    cells: {
      valid: { level: 'yes', note: 't_valid and t_invalid on every fact edge' },
      record: { level: 'yes', note: 't′created and t′expired: transactional time' },
      versions: { level: 'yes', note: 'a contradicted edge is invalidated, not deleted' },
      forgetting: no(),
      consolidation: {
        level: 'yes',
        note: 'episodes → entity graph → community summaries (label propagation)',
      },
      graph: { level: 'yes', note: 'episodic, semantic entity and community subgraphs' },
    },
    adopted: 'The closest prior art: bitemporal facts that are invalidated, never deleted.',
    differs:
      'Engram builds that core from scratch as immutable rows in Postgres, with a canonical as-of query, a 14-case conflict suite, decay, and its own benchmark against baselines.',
    lacks:
      'Community summaries, BFS graph search, and rerankers beyond RRF (MMR, cross-encoders, node distance).',
    benchmarks: 'DMR, LongMemEval',
  },
  {
    ref: 'xu2025',
    name: 'A-MEM',
    year: 2025,
    cells: {
      valid: no(),
      record: no(),
      versions: no('memory evolution replaces the original note'),
      forgetting: no(),
      consolidation: {
        level: 'partial',
        note: 'evolution rewrites neighbours’ context, keywords and tags',
      },
      graph: { level: 'partial', note: 'LLM-chosen links between notes, not entities' },
    },
    adopted: 'New memories should reshape old ones, not just pile up.',
    differs:
      'A-MEM’s model writes the links and rewrites notes in place. Engram links through resolved entities, with an explicit ladder (name, alias, embedding, LLM), and versions every change.',
    lacks: 'Rich per-memory metadata: keywords, tags and a contextual description on every note.',
    benchmarks: 'LoCoMo, DialSim',
  },
  {
    ref: 'gutierrez2024',
    name: 'HippoRAG',
    year: 2024,
    cells: {
      valid: no('documents, not conversations; no time'),
      record: no(),
      versions: no('new knowledge adds edges; nothing is superseded'),
      forgetting: no(),
      consolidation: no('an offline index over passages'),
      graph: {
        level: 'yes',
        note: 'OpenIE triples and synonymy edges, searched with Personalized PageRank',
      },
    },
    adopted: 'Entities as the index into memory, inspired by hippocampal indexing.',
    differs:
      'HippoRAG indexes documents and walks the whole graph with PageRank. Engram’s graph list is a one-hop expansion from the entities its top hits mention.',
    lacks: 'Multi-hop graph search: Personalized PageRank across many hops.',
    benchmarks: 'MuSiQue, 2WikiMultiHopQA, HotpotQA',
  },
];

export const ENGRAM: System = {
  ref: '',
  name: 'Engram',
  year: 2026,
  cells: {
    valid: { level: 'yes', note: 'valid_from / valid_to, with unknown starts' },
    record: { level: 'yes', note: 'recorded_at / invalidated_at; the canonical as-of query' },
    versions: { level: 'yes', note: 'immutable rows chained by revises and superseded_by' },
    forgetting: { level: 'yes', note: 'retention score per tier; reversible archive' },
    consolidation: { level: 'yes', note: 'nightly, provenance-aware; the only way into long_term' },
    graph: { level: 'partial', note: 'resolved entities; recall walks one hop' },
  },
  adopted: '',
  differs: '',
  lacks: '',
  benchmarks: 'own dev/test splits, LongMemEval-S (98 items)',
};

/** What each cited work is to Engram, for the timeline. */
export const ROLE: Record<string, 'theory' | 'method' | 'system' | 'benchmark' | 'model'> = {
  ebbinghaus1885: 'theory',
  cohen1960: 'method',
  tulving1972: 'theory',
  snodgrass1985: 'theory',
  mcclelland1995: 'theory',
  cormack2009: 'method',
  malkov2016: 'method',
  mcinnes2018: 'method',
  lewis2020: 'method',
  kusupati2022: 'model',
  liu2023: 'benchmark',
  zheng2023: 'method',
  packer2023: 'system',
  park2023: 'system',
  zhong2024: 'system',
  maharana2024: 'benchmark',
  gutierrez2024: 'system',
  wu2024: 'benchmark',
  chhikara2025: 'system',
  rasmussen2025: 'system',
  xu2025: 'system',
  lee2025: 'model',
  vera2025: 'model',
};

/** The year a reference is filed under: the four digits its key ends in. */
export const yearOf = (key: string) => Number(/(\d{4})$/.exec(key)?.[1] ?? 0);
