export const ENGRAM_VERSION = '0.0.0';

export { EMBEDDING_DIM, config } from './config/index.js';
export type { EngramConfig } from './config/index.js';
export * from './types/index.js';

export {
  DEFAULT_DATABASE_URL,
  SEARCH_PATH,
  UNKNOWN_START,
  createDb,
  isLocalUrl,
  transaction,
} from './db/client.js';
export type { DbOptions, Queryable, Sql, TransactionSql } from './db/client.js';
export { findEntitiesByAlias, findEntitiesByName, getEntity, insertEntity } from './db/entities.js';
export type { NewEntity } from './db/entities.js';
export { getEpisode, insertEpisode } from './db/episodes.js';
export type { NewEpisode } from './db/episodes.js';
export { insertFactRevision, listFactRevisions } from './db/factRevisions.js';
export type { NewFactRevision } from './db/factRevisions.js';
export {
  getFact,
  insertFact,
  invalidateFact,
  recordFactAccess,
  setFactPinned,
  setFactTier,
} from './db/facts.js';
export type { NewFact } from './db/facts.js';
export {
  SELF_ENTITY_NAME,
  cleanupDemoNamespaces,
  ensureNamespace,
  getNamespace,
  getNamespaceBySlug,
  getSelfEntity,
} from './db/namespaces.js';
export type { EnsureNamespaceInput, NamespaceWithSelf } from './db/namespaces.js';
export { cosine, l2Normalize } from './db/vector.js';

export * from './providers/contracts.js';
export { ProviderError, ProviderHttpError, ProviderOutputError } from './providers/provider.js';
export type { Provider } from './providers/provider.js';
export { FakeProvider, FakeProviderError, fakeEmbedding } from './providers/fake.js';
export type { FakeCall } from './providers/fake.js';
export {
  DEFAULT_EMBED_MODEL,
  GEMINI_BASE_URL,
  GeminiProvider,
  embedText,
  geminiKeysFromEnv,
} from './providers/gemini.js';
export type { GeminiOptions } from './providers/gemini.js';
export type { RetryOptions } from './providers/http.js';

export { ingest } from './ingest/ingest.js';
export type { IngestInput } from './ingest/ingest.js';

export { systemClock } from './config/clock.js';
export type { Clock } from './config/clock.js';
export {
  PREDICATES,
  PREDICATE_NAMES,
  getPredicate,
  lookupPredicate,
} from './conflict/predicates.js';
export type { PredicateSpec } from './conflict/predicates.js';
export { cleanName, normalizeName, normalizePredicate, toSnakeCase } from './extract/normalize.js';
export { PROMPT_VERSION } from './providers/promptVersion.js';
export { resolveHint } from './extract/temporal.js';
export { processEpisode } from './ingest/process.js';
export type { ProcessOptions, ProcessStatus, ProcessSummary } from './ingest/process.js';
export { createConflictResolver, currentBeliefs } from './conflict/resolver.js';
export { SimClock } from './config/clock.js';
export { asOfPredicate, episodesAsOfPredicate, factsAsOf } from './temporal/asOf.js';
export type { AsOf, FactsAsOfQuery } from './temporal/asOf.js';
export type {
  CandidateResolver,
  Resolution,
  ResolutionKind,
  ResolvedCandidate,
} from './ingest/resolver.js';
export { entityLabel, resolveEntity } from './resolve/entities.js';
export type { EntityResolution, ResolveContext, ResolvedVia } from './resolve/entities.js';
export { history } from './temporal/history.js';
export type { HistoryEntry, HistoryOptions } from './temporal/history.js';
export { DEFAULT_JUDGE_MODEL, GROQ_BASE_URL, GroqProvider } from './providers/groq.js';
export type { GroqOptions, GroqRequest } from './providers/groq.js';
export { DONT_KNOW } from './compose/prompt.js';
export { recall } from './retrieve/recall.js';
export type { ListName, RecallOptions, RecallResult, RecalledMemory } from './retrieve/recall.js';
export { trackUse } from './retrieve/access.js';
export { crossingDays, decayedAccess, retentionScore, tauDays } from './decay/score.js';
export type { RetentionInput } from './decay/score.js';
export { STATIC_PREDICATES, decaySweep, lastSweep } from './decay/sweep.js';
export type { SweepOptions } from './decay/sweep.js';
export { ForgetError, forget, restore } from './forget/forget.js';
export type { ForgetMode, ForgetOptions, ForgetResult, ForgetTarget } from './forget/forget.js';
export { REDACTED, purgeFacts } from './forget/purge.js';
export type { PurgeReport } from './forget/purge.js';
export { pendingClusters, splitSession } from './consolidate/cluster.js';
export type { Cluster, ClusterTurn, ConsolidationConfig } from './consolidate/cluster.js';
export { consolidate } from './consolidate/consolidate.js';
export type { ConsolidateOptions, ConsolidateSummary } from './consolidate/consolidate.js';
export { resolveCandidates } from './ingest/candidates.js';
export type { CandidateBatch, CandidateSource } from './ingest/candidates.js';
export { searchEntities } from './resolve/search.js';
export type { EntityHit, EntityMatch, SearchEntitiesOptions } from './resolve/search.js';
export { namespaceStats } from './stats/stats.js';
export type { NamespaceStats } from './stats/stats.js';
export { processPending } from './ingest/pending.js';
export type { PendingOptions, PendingResult } from './ingest/pending.js';
export { BenchSummary } from './types/benchSummary.js';
export { textArray, uuidArray } from './db/client.js';
export { DEFAULT_OLLAMA_MODEL, OLLAMA_BASE_URL, OllamaProvider } from './providers/ollama.js';
export type { OllamaOptions } from './providers/ollama.js';
export { packSessions, processSessions } from './ingest/sessions.js';
export type { SessionsOptions, SessionsSummary } from './ingest/sessions.js';
export { SESSION_PROMPT_VERSION } from './providers/promptVersion.js';
