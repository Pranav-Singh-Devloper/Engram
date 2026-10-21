// The architecture explorer's bibliography (P09c). Every entry was verified
// on 2026-10-21 against its arXiv page, DOI or publisher; venues are given
// only where that check confirmed them. `took` says what Engram adopted from
// the work or how it differs, so no citation is decoration.

export interface Reference {
  key: string;
  authors: string;
  title: string;
  /** Venue and year as verified; "arXiv" alone when no venue was confirmed. */
  venue: string;
  url: string | null;
  took: string;
}

export const REFERENCES: readonly Reference[] = [
  {
    key: 'wu2024',
    authors: 'Wu, D. et al.',
    title: 'LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory',
    venue: 'ICLR 2025 (arXiv 2024)',
    url: 'https://arxiv.org/abs/2410.10813',
    took: "Engram's external benchmark: a stratified 98-item subset of LongMemEval-S (SPEC §13.6). Its five abilities map onto Engram's categories, and its indexing / retrieval / reading split frames the recall chapter.",
  },
  {
    key: 'maharana2024',
    authors: 'Maharana, A. et al.',
    title: 'Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo)',
    venue: 'ACL 2024',
    url: 'https://arxiv.org/abs/2402.17753',
    took: 'Related long-conversation benchmark. Not run: LongMemEval was chosen for its abstention and knowledge-update categories, which test what Engram claims.',
  },
  {
    key: 'packer2023',
    authors: 'Packer, C. et al.',
    title: 'MemGPT: Towards LLMs as Operating Systems',
    venue: 'arXiv 2023',
    url: 'https://arxiv.org/abs/2310.08560',
    took: 'Prior art: the agent pages its own tiered memory. Engram is instead a memory service outside the agent, reached over MCP, so any client gets the same memory.',
  },
  {
    key: 'park2023',
    authors: 'Park, J. S. et al.',
    title: 'Generative Agents: Interactive Simulacra of Human Behavior',
    venue: 'arXiv 2023',
    url: 'https://arxiv.org/abs/2304.03442',
    took: "A memory stream scored by recency, importance and relevance, plus reflection. Engram uses recency, access and importance for decay (what to keep), while retrieval fuses ranked lists with RRF; consolidation plays reflection's role.",
  },
  {
    key: 'zhong2024',
    authors: 'Zhong, W. et al.',
    title: 'MemoryBank: Enhancing Large Language Models with Long-Term Memory',
    venue: 'AAAI 2024 (arXiv 2023)',
    url: 'https://arxiv.org/abs/2305.10250',
    took: "Forgetting-curve decay reinforced by recall. Engram's retention score keeps the idea (access reinforces), adds per-tier time constants, an archive threshold and predicates exempt from decay.",
  },
  {
    key: 'ebbinghaus1885',
    authors: 'Ebbinghaus, H. (tr. Ruger & Bussenius, 1913)',
    title: 'Memory: A Contribution to Experimental Psychology',
    venue: '1885; English translation 1913',
    url: 'https://psychclassics.yorku.ca/Ebbinghaus/memorypref.htm',
    took: 'The forgetting curve behind the exponential recency term in the retention score.',
  },
  {
    key: 'chhikara2025',
    authors: 'Chhikara, P. et al.',
    title: 'Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory',
    venue: 'arXiv 2025',
    url: 'https://arxiv.org/abs/2504.19413',
    took: 'Prior art: an extract-and-update layer with model-managed operations. Engram exposes that machinery (a rule fast path, a model adjudicator) and keeps every version with its record time.',
  },
  {
    key: 'rasmussen2025',
    authors: 'Rasmussen, P. et al.',
    title: 'Zep: A Temporal Knowledge Graph Architecture for Agent Memory',
    venue: 'arXiv 2025',
    url: 'https://arxiv.org/abs/2501.13956',
    took: 'The closest prior art: a bi-temporal graph that invalidates rather than deletes. Engram builds a comparable bitemporal core from scratch on Postgres, as immutable fact versions, and measures it against baselines and LongMemEval.',
  },
  {
    key: 'xu2025',
    authors: 'Xu, W. et al.',
    title: 'A-MEM: Agentic Memory for LLM Agents',
    venue: 'NeurIPS 2025',
    url: 'https://arxiv.org/abs/2502.12110',
    took: 'Self-organizing, linked notes. Engram links memories through an entity graph with an explicit resolution ladder instead of model-written links.',
  },
  {
    key: 'gutierrez2024',
    authors: 'Gutiérrez, B. J. et al.',
    title: 'HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models',
    venue: 'arXiv 2024',
    url: 'https://arxiv.org/abs/2405.14831',
    took: "Knowledge-graph retrieval with Personalized PageRank. Engram's graph list is a one-hop expansion from matched entities, not PageRank.",
  },
  {
    key: 'snodgrass1985',
    authors: 'Snodgrass, R. & Ahn, I.',
    title: 'A Taxonomy of Time in Databases',
    venue: 'SIGMOD 1985',
    url: 'https://doi.org/10.1145/318898.318921',
    took: 'Valid time versus transaction time: in Engram, valid_from/valid_to (when it was true) and recorded_at/invalidated_at (when Engram believed it).',
  },
  {
    key: 'tulving1972',
    authors: 'Tulving, E.',
    title: 'Episodic and Semantic Memory',
    venue: 'In Organization of Memory (Tulving & Donaldson, eds.), Academic Press, 1972',
    url: null,
    took: 'The two stores: episodes (what was said, when) and facts (what is true).',
  },
  {
    key: 'mcclelland1995',
    authors: 'McClelland, J. L., McNaughton, B. L. & O’Reilly, R. C.',
    title: 'Why There Are Complementary Learning Systems in the Hippocampus and Neocortex',
    venue: 'Psychological Review 102(3), 1995',
    url: 'https://doi.org/10.1037/0033-295X.102.3.419',
    took: 'Fast episodic capture, slow semantic consolidation: the shape of Engram’s nightly consolidation job.',
  },
  {
    key: 'cormack2009',
    authors: 'Cormack, G. V., Clarke, C. L. A. & Büttcher, S.',
    title: 'Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods',
    venue: 'SIGIR 2009',
    url: 'https://doi.org/10.1145/1571941.1572114',
    took: "Recall's default ranker: RRF with k = 60 over the candidate lists (ADR-010).",
  },
  {
    key: 'lewis2020',
    authors: 'Lewis, P. et al.',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    venue: 'NeurIPS 2020',
    url: 'https://arxiv.org/abs/2005.11401',
    took: 'The lineage of the rag baseline: top-k turns by embedding similarity, then generation.',
  },
  {
    key: 'liu2023',
    authors: 'Liu, N. F. et al.',
    title: 'Lost in the Middle: How Language Models Use Long Contexts',
    venue: 'TACL 2023',
    url: 'https://arxiv.org/abs/2307.03172',
    took: 'Why stuffing the whole history into the prompt (full_context) degrades as histories grow.',
  },
  {
    key: 'zheng2023',
    authors: 'Zheng, L. et al.',
    title: 'Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena',
    venue: 'arXiv 2023',
    url: 'https://arxiv.org/abs/2306.05685',
    took: "LLM judges and their biases; the reason Engram's judge is checked against blind hand labels.",
  },
  {
    key: 'cohen1960',
    authors: 'Cohen, J.',
    title: 'A Coefficient of Agreement for Nominal Scales',
    venue: 'Educational and Psychological Measurement 20(1), 1960',
    url: 'https://doi.org/10.1177/001316446002000104',
    took: 'Cohen’s κ, the judge-agreement statistic.',
  },
  {
    key: 'malkov2016',
    authors: 'Malkov, Y. A. & Yashunin, D. A.',
    title:
      'Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs',
    venue: 'arXiv 2016',
    url: 'https://arxiv.org/abs/1603.09320',
    took: 'The HNSW index pgvector builds over episode, fact and entity embeddings.',
  },
  {
    key: 'lee2025',
    authors: 'Lee, J. et al.',
    title: 'Gemini Embedding: Generalizable Embeddings from Gemini',
    venue: 'arXiv 2025',
    url: 'https://arxiv.org/abs/2503.07891',
    took: 'The default embedder (gemini-embedding-2), stored at 768 dimensions.',
  },
  {
    key: 'vera2025',
    authors: 'Schechter Vera, H. et al.',
    title: 'EmbeddingGemma: Powerful and Lightweight Text Representations',
    venue: 'arXiv 2025',
    url: 'https://arxiv.org/abs/2509.20354',
    took: 'The local-mode embedder (embeddinggemma:300m, 768-d), with its own calibrated thresholds (ADR-017).',
  },
  {
    key: 'kusupati2022',
    authors: 'Kusupati, A. et al.',
    title: 'Matryoshka Representation Learning',
    venue: 'arXiv 2022',
    url: 'https://arxiv.org/abs/2205.13147',
    took: 'The technique behind truncated embeddings. Engram requests 768 dimensions from Gemini Embedding instead of its full width (ADR-004), and EmbeddingGemma is natively 768-d, so both spaces fit one vector(768) column.',
  },
];

export const referenceNumber = (key: string) => REFERENCES.findIndex((r) => r.key === key) + 1;
