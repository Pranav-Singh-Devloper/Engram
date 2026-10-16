import { createHash } from 'node:crypto';
import { ADJUDICATE_SYSTEM, WireAdjudicate, adjudicateUser } from '../conflict/prompt.js';
import {
  DISAMBIGUATE_SYSTEM,
  PROCESS_EPISODE_SYSTEM,
  WireDisambiguate,
  WireProcessEpisode,
  disambiguateUser,
  jsonSchemaFor,
  processEpisodeUser,
} from '../extract/prompt.js';

function version(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\n---\n')).digest('hex').slice(0, 12);
}

const sampleDate = new Date('2000-01-01T00:00:00Z');

/**
 * Changes whenever a prompt or model-facing schema does. Recorded fixtures
 * carry it, so stale recordings fail loudly. User prompts are rendered from
 * fixed samples rather than hashing function source, which differs between
 * transpilers.
 */
export const PROMPT_VERSION = version(
  PROCESS_EPISODE_SYSTEM,
  JSON.stringify(jsonSchemaFor(WireProcessEpisode)),
  processEpisodeUser({
    content: 'sample',
    role: 'user',
    occurredAt: sampleDate,
    predicates: ['lives_in'],
  }),
  DISAMBIGUATE_SYSTEM,
  JSON.stringify(jsonSchemaFor(WireDisambiguate)),
  disambiguateUser({
    mention: { name: 'Sam', type: 'person', description: null },
    context: 'sample',
    candidates: [{ id: 'a', name: 'Sam', type: 'person', description: null, aliases: [] }],
  }),
  ADJUDICATE_SYSTEM,
  JSON.stringify(jsonSchemaFor(WireAdjudicate)),
  adjudicateUser({
    predicate: 'lives_in',
    context: 'sample',
    cardinality: 'one',
    mutability: 'dynamic',
    candidate: {
      statement: 's',
      validFrom: sampleDate,
      validTo: null,
      confidence: 0.5,
      isCorrection: false,
    },
    existing: [{ id: 'a', statement: 's', validFrom: sampleDate, validTo: null, confidence: 0.5 }],
  }),
);
