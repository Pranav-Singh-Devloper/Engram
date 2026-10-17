// The prompts, id aliasing and validation shared by every chat provider. A
// subclass supplies the transport (`send`) and embeddings, so Gemini and a
// local Ollama model ask exactly the same questions.
import {
  DISAMBIGUATE_SYSTEM,
  PROCESS_EPISODE_SYSTEM,
  WireDisambiguate,
  WireProcessEpisode,
  disambiguateUser,
  jsonSchemaFor,
  processEpisodeUser,
} from '../extract/prompt.js';
import { ADJUDICATE_SYSTEM, WireAdjudicate, adjudicateUser } from '../conflict/prompt.js';
import { COMPOSE_SYSTEM, WireCompose, composeUser, normalizeCompose } from '../compose/prompt.js';
import { SUMMARIZE_SYSTEM, WireSummarize, summarizeUser } from '../consolidate/prompt.js';
import {
  EXTRACT_SESSIONS_SYSTEM,
  WireExtractSessions,
  extractSessionsUser,
} from '../extract/sessionPrompt.js';
import {
  AdjudicateInput,
  ComposeInput,
  DisambiguateInput,
  ExtractSessionsInput,
  ProcessEpisodeInput,
  SummarizeInput,
} from './contracts.js';
import type { EmbedPurpose, MethodInput, MethodOutput, StructuredMethod } from './contracts.js';
import { aliasIds } from './aliases.js';
import type { Provider } from './provider.js';
import { ProviderError, ProviderOutputError } from './provider.js';
import { generateStructured } from './structured.js';
import type { ChatSend, StructuredRequest } from './structured.js';

const PROCESS_EPISODE_JSON_SCHEMA = jsonSchemaFor(WireProcessEpisode);
const DISAMBIGUATE_JSON_SCHEMA = jsonSchemaFor(WireDisambiguate);
const ADJUDICATE_JSON_SCHEMA = jsonSchemaFor(WireAdjudicate);
const COMPOSE_JSON_SCHEMA = jsonSchemaFor(WireCompose);
const SUMMARIZE_JSON_SCHEMA = jsonSchemaFor(WireSummarize);
const EXTRACT_SESSIONS_JSON_SCHEMA = jsonSchemaFor(WireExtractSessions);

export abstract class PromptedProvider implements Provider {
  abstract readonly name: string;
  abstract embed(texts: readonly string[], options: { purpose: EmbedPurpose }): Promise<number[][]>;
  abstract embeddingSpace(): Promise<string>;
  /** The transport, or a rejection explaining why there is none (no model configured). */
  protected abstract chat(): ChatSend | Error;

  /**
   * Structured calls so far: how many needed the one repair round, and how
   * many failed even after it. The off-schema rate (P08b decision 5).
   */
  readonly structuredStats = { calls: 0, repairs: 0, failures: 0 };

  /** JSON generation with zod validation and one repair attempt. Used by structured methods. */
  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const send = this.chat();
    if (send instanceof Error) throw send;
    let sends = 0;
    const counted: ChatSend = (r) => {
      sends++;
      return send(r);
    };
    this.structuredStats.calls++;
    try {
      return await generateStructured(counted, request);
    } catch (err) {
      if (err instanceof ProviderOutputError) this.structuredStats.failures++;
      throw err;
    } finally {
      if (sends > 1) this.structuredStats.repairs++;
    }
  }

  private notYet<M extends StructuredMethod>(method: M, where: string): Promise<MethodOutput<M>> {
    return Promise.reject(new ProviderError(`${this.name}.${method}: see ${where}.`));
  }

  processEpisode = (input: MethodInput<'processEpisode'>) =>
    this.generate({
      system: PROCESS_EPISODE_SYSTEM,
      user: processEpisodeUser(ProcessEpisodeInput.parse(input)),
      schema: WireProcessEpisode,
      jsonSchema: PROCESS_EPISODE_JSON_SCHEMA,
    });

  adjudicate = async (input: MethodInput<'adjudicate'>) => {
    const parsed = AdjudicateInput.parse(input);
    const ids = aliasIds(
      parsed.existing.map((e) => e.id),
      'f',
    );
    const out = await this.generate({
      system: ADJUDICATE_SYSTEM,
      user: adjudicateUser({
        ...parsed,
        existing: parsed.existing.map((e) => ({ ...e, id: ids.label(e.id) })),
      }),
      schema: WireAdjudicate,
      jsonSchema: ADJUDICATE_JSON_SCHEMA,
    });
    return {
      ...out,
      targetFactId: out.targetFactId === null ? null : ids.resolve(out.targetFactId),
    };
  };

  disambiguate = async (input: MethodInput<'disambiguate'>) => {
    const parsed = DisambiguateInput.parse(input);
    const ids = aliasIds(
      parsed.candidates.map((c) => c.id),
      'c',
    );
    const out = await this.generate({
      system: DISAMBIGUATE_SYSTEM,
      user: disambiguateUser({
        ...parsed,
        candidates: parsed.candidates.map((c) => ({ ...c, id: ids.label(c.id) })),
      }),
      schema: WireDisambiguate,
      jsonSchema: DISAMBIGUATE_JSON_SCHEMA,
    });
    return { ...out, entityId: out.entityId === null ? null : ids.resolve(out.entityId) };
  };

  compose = async (input: MethodInput<'compose'>) => {
    const parsed = ComposeInput.parse(input);
    const ids = aliasIds(
      parsed.memories.map((m) => m.id),
      'm',
    );
    const out = await this.generate({
      system: COMPOSE_SYSTEM,
      user: composeUser({
        ...parsed,
        memories: parsed.memories.map((m) => ({ ...m, id: ids.label(m.id) })),
      }),
      schema: WireCompose,
      jsonSchema: COMPOSE_JSON_SCHEMA,
    });
    return normalizeCompose({ ...out, usedMemoryIds: out.usedMemoryIds.map(ids.resolve) }, parsed);
  };
  summarize = async (input: MethodInput<'summarize'>) => {
    const parsed = SummarizeInput.parse(input);
    const turns = aliasIds(
      parsed.episodes.map((e) => e.id),
      't',
    );
    const out = await this.generate({
      system: SUMMARIZE_SYSTEM,
      user: summarizeUser({
        ...parsed,
        episodes: parsed.episodes.map((e) => ({ ...e, id: turns.label(e.id) })),
      }),
      schema: WireSummarize,
      jsonSchema: SUMMARIZE_JSON_SCHEMA,
    });
    // Cited labels map back to episode ids; a candidate citing no real turn has no provenance.
    const known = new Set(parsed.episodes.map((e) => e.id));
    const candidates = out.candidates
      .map((c) => ({
        ...c,
        sourceEpisodeIds: c.sourceEpisodeIds.map(turns.resolve).filter((id) => known.has(id)),
      }))
      .filter((c) => c.sourceEpisodeIds.length > 0);
    return { summary: out.summary, candidates };
  };
  extractSessions = async (input: MethodInput<'extractSessions'>) => {
    const parsed = ExtractSessionsInput.parse(input);
    const turns = aliasIds(
      parsed.turns.map((t) => t.id),
      't',
    );
    const sessions = aliasIds([...new Set(parsed.turns.map((t) => t.sessionId))], 's');
    const out = await this.generate({
      system: EXTRACT_SESSIONS_SYSTEM,
      user: extractSessionsUser({
        ...parsed,
        turns: parsed.turns.map((t) => ({
          ...t,
          id: turns.label(t.id),
          sessionId: sessions.label(t.sessionId),
        })),
      }),
      schema: WireExtractSessions,
      jsonSchema: EXTRACT_SESSIONS_JSON_SCHEMA,
    });
    // Labels map back to episode ids; anything citing no real turn is dropped.
    const known = new Set(parsed.turns.map((t) => t.id));
    const real = (label: string) => {
      const id = turns.resolve(label);
      return known.has(id) ? [id] : [];
    };
    return {
      importance: out.importance.flatMap((i) =>
        real(i.episodeId).map((episodeId) => ({ episodeId, importance: i.importance })),
      ),
      candidates: out.candidates
        .map((c) => ({ ...c, sourceEpisodeIds: c.sourceEpisodeIds.flatMap(real) }))
        .filter((c) => c.sourceEpisodeIds.length > 0),
    };
  };

  /** The bench judge runs on a different model family (GroqProvider). */
  judge = () => this.notYet('judge', 'GroqProvider');
}
