// Seeded persona timelines: the bench's ground truth (SPEC §13.2). Plain data
// and code, written without reference to Engram's predicate registry. Each
// session lists the statements the user makes in it; `verbalize.ts` turns
// those into natural turns, and `questions.ts` derives questions and exact
// answers from the same timeline.

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** Picks `n` distinct items. */
export function sample<T>(random: () => number, items: readonly T[], n: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }
  return out;
}

const NAMES = [
  'Priya',
  'Mateo',
  'Aisha',
  'Lukas',
  'Mei',
  'Tomás',
  'Noor',
  'Elena',
  'Kwame',
  'Sofia',
  'Ravi',
  'Ingrid',
];
const SIBLING_NAMES = ['Ana', 'Hana', 'Leila', 'Marta', 'Zoe', 'Freya', 'Imani', 'Rosa'];
const PARTNER_NAMES = ['Jordan', 'Sam', 'Alex', 'Robin', 'Casey', 'Morgan', 'Jamie', 'Riley'];
const CITIES = [
  'Lisbon',
  'Berlin',
  'Toronto',
  'Melbourne',
  'Osaka',
  'Nairobi',
  'Valencia',
  'Montreal',
  'Edinburgh',
  'Seoul',
  'Porto',
  'Denver',
  'Lyon',
  'Marseille',
  'Krakow',
  'Austin',
];
const EMPLOYERS = [
  'Northwind',
  'Acme Robotics',
  'Globex',
  'Initech',
  'Umbrella Health',
  'Stark Analytics',
  'Wayne Logistics',
  'Hooli',
  'Vandelay Imports',
  'Soylent Foods',
];
const JOBS = [
  'data engineer',
  'nurse',
  'product manager',
  'architect',
  'chef',
  'teacher',
  'UX designer',
  'pharmacist',
];
const PET_SPECIES = ['dog', 'cat', 'parrot', 'rabbit'];
const PET_NAMES = ['Biscuit', 'Mochi', 'Pepper', 'Luna', 'Ziggy', 'Olive', 'Rocket', 'Nori'];
const ALLERGIES = ['peanuts', 'shellfish', 'penicillin', 'pollen'];
const INSTRUMENTS = ['cello', 'guitar', 'piano', 'violin', 'drums'];
const FOODS = ['ramen', 'tacos', 'sushi', 'dim sum', 'pho', 'paella'];
const LANGUAGES = ['Japanese', 'Portuguese', 'German', 'Korean'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** How the user conveys a statement. */
export type Style = 'plain' | 'paraphrase' | 'implicit';

export interface Statement {
  /** Stable key, e.g. `pet` or `move`. */
  key: string;
  /** What the user conveys, as an instruction to the verbalizer. */
  says: string;
  /** Strings that must appear verbatim in the session's turns. */
  mustInclude: string[];
  style: Style;
}

export interface SessionPlan {
  sessionId: string;
  occurredAt: Date;
  statements: Statement[];
}

export interface Home {
  city: string;
  /** null: unknown start. */
  from: Date | null;
  /** null: still living there. */
  to: Date | null;
  /** When the user said it, i.e. when the system could have learned it. */
  saidAt: Date;
}

export interface Job {
  employer: string;
  title: string;
  from: Date;
  to: Date | null;
  saidAt: Date;
}

export interface Persona {
  id: string;
  name: string;
  sister: { name: string; city: string };
  partner: { name: string; employer: string };
  pet: { species: string; name: string };
  allergy: string;
  instrument: string;
  food: string;
  language: string;
  homes: Home[];
  jobs: Job[];
  /** Explicit move ("I moved in March") or implicit ("loving my new place in…"). */
  moveStyle: 'plain' | 'implicit';
  sessions: SessionPlan[];
  /** Things this persona never mentions, for abstention questions. */
  neverMentions: { question: string; forbid: string[] }[];
}

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m - 1, d, 9, 0, 0));
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
export const monthName = (d: Date) => `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`;

const ABSENT = [
  { question: "What's my brother's name?", forbid: ['brother'] },
  { question: 'What car do I drive?', forbid: ['car', 'drive'] },
  { question: 'Which university did I go to?', forbid: ['university', 'college', 'degree'] },
  { question: "What's my mother's name?", forbid: ['mother', 'mom', 'mum'] },
];

export function buildPersona(index: number, seed: number): Persona {
  const random = rng(seed * 1000 + index);
  const id = `p${index + 1}`;
  const name = NAMES[index % NAMES.length] ?? 'Alex';
  const [home1, home2, sisterCity, oldHome] = sample(random, CITIES, 4) as [
    string,
    string,
    string,
    string,
  ];
  const [employer1, employer2, partnerEmployer] = sample(random, EMPLOYERS, 3) as [
    string,
    string,
    string,
  ];
  const title = pick(random, JOBS);
  const sisterName = pick(random, SIBLING_NAMES);
  const partnerName = pick(random, PARTNER_NAMES);
  const pet = { species: pick(random, PET_SPECIES), name: pick(random, PET_NAMES) };
  const allergy = pick(random, ALLERGIES);
  const instrument = pick(random, INSTRUMENTS);
  const food = pick(random, FOODS);
  const language = pick(random, LANGUAGES);
  const changesJob = random() < 0.5;
  const moveStyle = random() < 0.5 ? 'plain' : 'implicit';

  // Session dates: an intro in January/February 2024, then three more months apart.
  const s1 = utc(2024, 1 + Math.floor(random() * 2), 5 + Math.floor(random() * 20));
  const s2 = addDays(s1, 40 + Math.floor(random() * 20));
  const moveDate = utc(s2.getUTCFullYear(), s2.getUTCMonth() + 2, 1); // first of the month after s2
  const s3 = addDays(moveDate, 30 + Math.floor(random() * 20));
  const s4 = addDays(s3, 20 + Math.floor(random() * 15));
  const oldFrom = 2014 + Math.floor(random() * 3);
  const oldTo = oldFrom + 2 + Math.floor(random() * 3);
  const home1From = utc(oldTo, 1);
  const jobChange = changesJob ? utc(s3.getUTCFullYear(), s3.getUTCMonth() + 1, 1) : null;

  const homes: Home[] = [
    { city: oldHome, from: utc(oldFrom, 1), to: home1From, saidAt: s4 },
    { city: home1, from: home1From, to: moveDate, saidAt: s1 },
    { city: home2, from: moveDate, to: null, saidAt: s3 },
  ];
  const jobs: Job[] = [{ employer: employer1, title, from: s1, to: jobChange, saidAt: s1 }];
  if (jobChange) jobs.push({ employer: employer2, title, from: jobChange, to: null, saidAt: s3 });

  const moveMonth = MONTHS[moveDate.getUTCMonth()] ?? '';
  const sessions: SessionPlan[] = [
    {
      sessionId: `${id}-s1`,
      occurredAt: s1,
      statements: [
        {
          key: 'name',
          says: `Introduce yourself as ${name}.`,
          mustInclude: [name],
          style: 'plain',
        },
        { key: 'home', says: `You live in ${home1}.`, mustInclude: [home1], style: 'plain' },
        {
          key: 'job',
          says: `You work as a ${title} at ${employer1}.`,
          mustInclude: [title, employer1],
          style: 'plain',
        },
        {
          key: 'pet',
          says: `You have a ${pet.species} named ${pet.name}.`,
          mustInclude: [pet.species, pet.name],
          style: 'plain',
        },
        {
          key: 'sister',
          says: `Your sister ${sisterName} lives in ${sisterCity}.`,
          mustInclude: [sisterName, sisterCity, 'sister'],
          style: 'plain',
        },
      ],
    },
    {
      sessionId: `${id}-s2`,
      occurredAt: s2,
      statements: [
        {
          key: 'food',
          says: `Your favourite food is ${food}.`,
          mustInclude: [food],
          style: 'plain',
        },
        {
          key: 'allergy',
          says: `You are allergic to ${allergy}.`,
          mustInclude: [allergy],
          style: 'plain',
        },
        {
          key: 'instrument',
          says: `You play the ${instrument}.`,
          mustInclude: [instrument],
          style: 'plain',
        },
        {
          key: 'partner',
          says: `Your partner ${partnerName} works at ${partnerEmployer}.`,
          mustInclude: [partnerName, partnerEmployer, 'partner'],
          style: 'plain',
        },
      ],
    },
    {
      sessionId: `${id}-s3`,
      occurredAt: s3,
      statements: [
        moveStyle === 'plain'
          ? {
              key: 'move',
              says: `You moved from ${home1} to ${home2} in ${moveMonth}.`,
              mustInclude: [home2, moveMonth],
              style: 'plain',
            }
          : {
              key: 'move',
              says: `Without saying the word "moved", make clear you now live in ${home2} and have since ${moveMonth}, for example by talking about your new neighbourhood there.`,
              mustInclude: [home2, moveMonth],
              style: 'implicit',
            },
        {
          key: 'pet-again',
          says: `Mention your ${pet.species} ${pet.name} again, in different words than before.`,
          mustInclude: [pet.name],
          style: 'paraphrase',
        },
        ...(jobChange
          ? [
              {
                key: 'job-change',
                says: `You started a new job at ${employer2} in ${MONTHS[jobChange.getUTCMonth()] ?? ''}, still as a ${title}.`,
                mustInclude: [employer2],
                style: 'plain' as const,
              },
            ]
          : []),
      ],
    },
    {
      sessionId: `${id}-s4`,
      occurredAt: s4,
      statements: [
        {
          key: 'old-home',
          says: `Before ${home1}, you lived in ${oldHome} from ${oldFrom} to ${oldTo}.`,
          mustInclude: [oldHome, String(oldFrom), String(oldTo)],
          style: 'plain',
        },
        {
          key: 'language',
          says: `You are learning ${language}.`,
          mustInclude: [language],
          style: 'plain',
        },
      ],
    },
  ];

  return {
    id,
    name,
    sister: { name: sisterName, city: sisterCity },
    partner: { name: partnerName, employer: partnerEmployer },
    pet,
    allergy,
    instrument,
    food,
    language,
    homes,
    jobs,
    moveStyle,
    sessions,
    neverMentions: sample(random, ABSENT, 2),
  };
}

/** Where the persona lived at valid time `t`, per the ground truth. */
export function homeAt(p: Persona, t: Date): string | null {
  return (
    p.homes.find((h) => (h.from === null || h.from <= t) && (h.to === null || t < h.to))?.city ??
    null
  );
}

/** Where the system could have believed they lived at `t`, given only what was said by `knownAt`. */
export function believedHomeAt(p: Persona, t: Date, knownAt: Date): string | null {
  const known = p.homes.filter((h) => h.saidAt <= knownAt);
  // Without the move being said, the last-known home is still open-ended.
  const open = known.map((h) =>
    known.some((k) => k.from !== null && h.to !== null && k.from.getTime() === h.to.getTime())
      ? h
      : { ...h, to: null },
  );
  return (
    open.find((h) => (h.from === null || h.from <= t) && (h.to === null || t < h.to))?.city ?? null
  );
}

export function employerAt(p: Persona, t: Date): string | null {
  return p.jobs.find((j) => j.from <= t && (j.to === null || t < j.to))?.employer ?? null;
}
