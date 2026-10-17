// The labelled pair set for similarity-threshold calibration (P08b decision 6,
// ADR-017). Built once from the dev personas' code-defined ground truth and
// dev-long's verbalized turns, never from test: the generator knows which
// strings name the same thing, so no embedder influences a label.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPersona } from '../dataset/personas.js';
import type { Persona } from '../dataset/personas.js';
import { SplitFile } from '../dataset/schema.js';

/** Which engine threshold a family calibrates, and which side of it a positive pair belongs on. */
export const FAMILIES = {
  /** Two labels of the same entity merge at ≥ t (entities.matchThreshold). */
  entityMatch: 'positive pairs should score ≥ t',
  /** The same name: same person ≥ t, different people < t (entities.descriptionConflictThreshold). */
  descriptionConflict: 'positive pairs (same person) should score ≥ t',
  /** A paraphrase of the same fact merges at ≥ t; another value must not (conflict.mergeThreshold). */
  merge: 'positive pairs should score ≥ t',
  /** A query naming or describing an entity lists it at ≥ t (entities.searchMinSimilarity). */
  entitySearch: 'positive pairs should score ≥ t',
  /** Consecutive turns in one session stay together at ≥ t (consolidation.driftThreshold). */
  drift: 'positive pairs should score ≥ t',
} as const;
export type Family = keyof typeof FAMILIES;

export interface Pair {
  family: Family;
  a: string;
  b: string;
  positive: boolean;
  /** Which text is the query side (entity search embeds it as a query). */
  query?: boolean;
}

const DEV = path.resolve(import.meta.dirname, '../dataset');

function devPersonas(): Persona[] {
  const dev = SplitFile.parse(JSON.parse(readFileSync(path.join(DEV, 'dev.json'), 'utf8')));
  const ids = [...new Set(dev.items.map((i) => i.persona))].sort();
  return ids.map((id) => buildPersona(Number(id.slice(1)) - 1, dev.seed));
}

/** Pairs within a list of persona-derived values: every value against every other. */
function crossPairs<T>(items: T[], f: (a: T, b: T) => Pair | null): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const p = f(items[i] as T, items[j] as T);
      if (p) out.push(p);
    }
  }
  return out;
}

export function buildPairs(): Pair[] {
  const personas = devPersonas();
  const pairs: Pair[] = [];
  const cities = [...new Set(personas.flatMap((p) => p.homes.map((h) => h.city)))].sort();
  const employers = [...new Set(personas.flatMap((p) => p.jobs.map((j) => j.employer)))].sort();
  const sisters = [...new Set(personas.map((p) => p.sister.name))].sort();

  // Entity match: one entity labelled two ways vs two entities of one type.
  for (const c of cities) {
    pairs.push({
      family: 'entityMatch',
      a: `${c} (place): a city`,
      b: `${c} (place): where the user lives`,
      positive: true,
    });
  }
  for (const e of employers) {
    pairs.push({
      family: 'entityMatch',
      a: `${e} (org): a company`,
      b: `${e} (org): the user's employer`,
      positive: true,
    });
  }
  pairs.push(
    ...crossPairs(cities, (a, b) => ({
      family: 'entityMatch',
      a: `${a} (place): a city`,
      b: `${b} (place): a city`,
      positive: false,
    })),
    ...crossPairs(employers, (a, b) => ({
      family: 'entityMatch',
      a: `${a} (org): a company`,
      b: `${b} (org): a company`,
      positive: false,
    })),
  );

  // Description conflict: the same name, the same person or two different people.
  for (const p of personas) {
    const n = p.sister.name;
    pairs.push(
      {
        family: 'descriptionConflict',
        a: `${n} (person): the user's sister`,
        b: `${n} (person): the user's sister, lives in ${p.sister.city}`,
        positive: true,
      },
      {
        family: 'descriptionConflict',
        a: `${n} (person): the user's sister`,
        b: `${n} (person): the user's manager at work`,
        positive: false,
      },
      {
        family: 'descriptionConflict',
        a: `${p.partner.name} (person): the user's partner`,
        b: `${p.partner.name} (person): the user's partner, works at ${p.partner.employer}`,
        positive: true,
      },
      {
        family: 'descriptionConflict',
        a: `${p.partner.name} (person): the user's partner`,
        b: `${p.partner.name} (person): the user's neighbour`,
        positive: false,
      },
    );
  }

  // Merge: paraphrases of one fact vs the same predicate with another value.
  for (const p of personas) {
    pairs.push(
      {
        family: 'merge',
        a: `The user is allergic to ${p.allergy}.`,
        b: `The user has an allergy to ${p.allergy}.`,
        positive: true,
      },
      {
        family: 'merge',
        a: `The user plays the ${p.instrument}.`,
        b: `The user plays ${p.instrument}.`,
        positive: true,
      },
      {
        family: 'merge',
        a: `The user likes ${p.food}.`,
        b: `The user enjoys ${p.food}.`,
        positive: true,
      },
      {
        family: 'merge',
        a: `The user has a ${p.pet.species} named ${p.pet.name}.`,
        b: `The user's ${p.pet.species} is called ${p.pet.name}.`,
        positive: true,
      },
    );
  }
  pairs.push(
    ...crossPairs(cities, (a, b) => ({
      family: 'merge',
      a: `The user lives in ${a}.`,
      b: `The user lives in ${b}.`,
      positive: false,
    })),
    ...crossPairs(employers, (a, b) => ({
      family: 'merge',
      a: `The user works at ${a}.`,
      b: `The user works at ${b}.`,
      positive: false,
    })),
  );

  // Entity search: a query that names or describes an entity vs unrelated labels.
  for (const p of personas) {
    const sister = `${p.sister.name} (person): the user's sister`;
    pairs.push(
      { family: 'entitySearch', a: p.sister.name, b: sister, positive: true, query: true },
      { family: 'entitySearch', a: 'my sister', b: sister, positive: true, query: true },
      {
        family: 'entitySearch',
        a: p.sister.name,
        b: `${p.sister.city} (place): a city`,
        positive: false,
        query: true,
      },
      {
        family: 'entitySearch',
        a: p.sister.name,
        b: `${p.jobs[0]?.employer ?? 'Acme'} (org): a company`,
        positive: false,
        query: true,
      },
    );
  }
  for (const [i, s] of sisters.entries()) {
    const other = sisters[(i + 1) % sisters.length];
    if (other && other !== s) {
      pairs.push({
        family: 'entitySearch',
        a: s,
        b: `${other} (person): the user's sister`,
        positive: false,
        query: true,
      });
    }
  }

  // Drift: consecutive turns in one session vs turns from different sessions (dev-long).
  const long = SplitFile.parse(JSON.parse(readFileSync(path.join(DEV, 'dev-long.json'), 'utf8')));
  const seen = new Set<string>();
  const sessions = long.items
    .flatMap((i) => i.setup_sessions)
    .filter((s) => !seen.has(s.session_id) && seen.add(s.session_id));
  for (const s of sessions) {
    for (let i = 0; i + 1 < s.turns.length; i++) {
      pairs.push({ family: 'drift', a: s.turns[i] ?? '', b: s.turns[i + 1] ?? '', positive: true });
    }
  }
  for (let i = 0; i + 1 < sessions.length; i += 2) {
    const a = sessions[i]?.turns.at(-1);
    const b = sessions[i + 1]?.turns[0];
    if (a && b) pairs.push({ family: 'drift', a, b, positive: false });
  }
  return pairs;
}
