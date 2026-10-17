// The predicate registry (SPEC §7.1). Extraction prefers these names, and
// ad-hoc predicates are normalized through the synonym map before storage.
// The ad-hoc rate is tracked: if it climbs, the registry is missing something.

export interface PredicateSpec {
  name: string;
  cardinality: 'one' | 'many';
  mutability: 'static' | 'dynamic';
  synonyms: readonly string[];
  /** `a p b` means `b p a`: stored one way round so restatements merge. */
  symmetric?: boolean;
  /** Shown to the extraction model. */
  description: string;
}

export const PREDICATES: readonly PredicateSpec[] = [
  {
    name: 'lives_in',
    cardinality: 'one',
    mutability: 'dynamic',
    synonyms: ['resides_in', 'based_in', 'moved_to', 'home_city', 'lived_in', 'resided_in'],
    description: 'the place someone lives',
  },
  {
    name: 'works_at',
    cardinality: 'one',
    mutability: 'dynamic',
    synonyms: ['employed_by', 'job_at', 'worked_at'],
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
  // Added in P05 from the ad-hoc predicates the dev runs produced (34% ad hoc,
  // SPEC §18). Synonyms are the spellings the model actually used.
  {
    name: 'occupation',
    cardinality: 'one',
    mutability: 'dynamic',
    synonyms: ['has_occupation', 'job_title', 'profession', 'works_as', 'job', 'role', 'has_job'],
    description: "someone's job or profession, as a literal",
  },
  {
    name: 'sibling_of',
    cardinality: 'many',
    mutability: 'static',
    synonyms: ['sister_of', 'brother_of', 'has_sister', 'has_brother', 'sibling', 'has_sibling'],
    symmetric: true,
    description: 'a sibling relationship between two people',
  },
  {
    name: 'partner_of',
    cardinality: 'one',
    mutability: 'dynamic',
    synonyms: [
      'has_partner',
      'partner',
      'in_relationship_with',
      'dating',
      'married_to',
      'spouse_of',
    ],
    symmetric: true,
    description: "someone's romantic partner or spouse",
  },
  {
    name: 'allergic_to',
    cardinality: 'many',
    mutability: 'dynamic',
    synonyms: ['is_allergic_to', 'has_allergy', 'allergy'],
    description: 'something someone is allergic to',
  },
  {
    name: 'has_pet',
    cardinality: 'many',
    mutability: 'dynamic',
    synonyms: ['pet', 'owns_pet', 'has_dog', 'has_cat'],
    description: 'an animal someone keeps as a pet',
  },
  {
    name: 'plays',
    cardinality: 'many',
    mutability: 'dynamic',
    synonyms: ['plays_instrument', 'plays_the'],
    description: 'an instrument or sport someone plays',
  },
  {
    name: 'learning',
    cardinality: 'many',
    mutability: 'dynamic',
    synonyms: ['is_learning', 'studying', 'studies', 'learning_language'],
    description: 'something someone is learning, such as a language',
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
