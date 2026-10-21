// The bitemporal story as the engine stored it (bench explorer:data), typed
// and revived: Dates, with null valid_from meaning an unknown start.
import raw from '@/content/generated/bitemporal.json';
import { UNKNOWN_START_MS } from '@/lib/format';

export interface StoryVersion {
  id: string;
  predicate: string;
  object: string;
  statement: string;
  status: string;
  validFrom: Date;
  unknownStart: boolean;
  validTo: Date | null;
  recordedAt: Date;
  invalidatedAt: Date | null;
  revises: string | null;
  supersededBy: string | null;
}

const d = (s: string) => new Date(s);

export const STORY = {
  now: d(raw.now),
  turns: raw.turns.map((t) => ({ ...t, at: d(t.at), learnedAt: d(t.learnedAt) })),
  versions: raw.versions.map((v): StoryVersion => ({
    ...v,
    validFrom: v.validFrom ? d(v.validFrom) : new Date(UNKNOWN_START_MS),
    unknownStart: v.validFrom === null,
    validTo: v.validTo ? d(v.validTo) : null,
    recordedAt: d(v.recordedAt),
    invalidatedAt: v.invalidatedAt ? d(v.invalidatedAt) : null,
  })),
  revisions: raw.revisions,
  answers: raw.answers,
};
