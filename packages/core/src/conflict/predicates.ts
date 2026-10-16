// The predicate registry (SPEC §7.1). Extraction prefers these names, and
// ad-hoc predicates are normalized through the synonym map before storage.
// The ad-hoc rate is tracked: if it climbs, the registry is missing something.

export interface PredicateSpec {
  name: string;
  cardinality: 'one' | 'many';
  mutability: 'static' | 'dynamic';
  synonyms: readonly string[];
  /** Shown to the extraction model. */
  description: string;
}

export const PREDICATES: readonly PredicateSpec[] = [
  {
    name: 'lives_in',
    cardinality: 'one',
    mutability: 'dynamic',
    synonyms: ['resides_in', 'based_in', 'moved_to', 'home_city'],
    description: 'the place someone lives',
  },
  {
    name: 'works_at',
    cardinality: 'one',
    mutability: 'dynamic',
    synonyms: ['employed_by', 'job_at'],
    description: 'the organization someone works for',
  },
  {
    name: 'birth_date',
    cardinality: 'one',
    mutability: 'static',
    synonyms: ['born_on'],
    description: 'date of birth, as an ISO date literal',
  },
  {
    name: 'is_named',
    cardinality: 'one',
    mutability: 'static',
    synonyms: [],
    description: "a person's name, as a literal",
  },
  {
    name: 'likes',
    cardinality: 'many',
    mutability: 'dynamic',
    synonyms: [],
    description: 'something someone enjoys or prefers',
  },
  {
    name: 'visited',
    cardinality: 'many',
    mutability: 'dynamic',
    synonyms: [],
    description: 'a place someone has been to',
  },
];

const BY_NAME = new Map(PREDICATES.map((p) => [p.name, p]));
const BY_SYNONYM = new Map(PREDICATES.flatMap((p) => p.synonyms.map((s) => [s, p] as const)));

export function getPredicate(name: string): PredicateSpec | undefined {
  return BY_NAME.get(name);
}

/** The registry entry a snake_case name or synonym refers to. */
export function lookupPredicate(snakeName: string): PredicateSpec | undefined {
  return BY_NAME.get(snakeName) ?? BY_SYNONYM.get(snakeName);
}

export const PREDICATE_NAMES: readonly string[] = PREDICATES.map((p) => p.name);
