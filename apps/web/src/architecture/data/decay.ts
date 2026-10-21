// The retention score (SPEC §9.1), mirrored from core's decay/score.ts for the
// decay chapter's curves; decay.test.ts proves the values equal retentionScore.
import { ARCHIVE_THRESHOLD } from '@/lib/format';

export const DECAY = {
  tauWorkingDays: 14,
  tauLongTermDays: 90,
  archiveThreshold: ARCHIVE_THRESHOLD,
  recencyWeight: 0.5,
  accessWeight: 0.25,
  importanceWeight: 0.25,
  accessSaturation: 20,
} as const;

export type Tier = 'working' | 'long_term';

export const tauDays = (tier: Tier): number =>
  tier === 'long_term' ? DECAY.tauLongTermDays : DECAY.tauWorkingDays;

/** The three weighted terms after `days` without access, and their sum. */
export function retention(importance: number, accessScore: number, days: number, tier: Tier) {
  const recency = DECAY.recencyWeight * Math.exp(-Math.max(0, days) / tauDays(tier));
  const access =
    DECAY.accessWeight *
    Math.min(1, Math.log(1 + accessScore) / Math.log(1 + DECAY.accessSaturation));
  const imp = DECAY.importanceWeight * importance;
  return { recency, access, importance: imp, score: recency + access + imp };
}

/** access_score after Δt days of decay: a · exp(−Δt / τ_tier) (core decayedAccess). */
export const decayedAccess = (a: number, days: number, tier: Tier) =>
  a * Math.exp(-days / tauDays(tier));

/** The score `days` after the last access, with the access score decaying as the sweep does. */
export const scoreAfter = (importance: number, accessScore: number, days: number, tier: Tier) =>
  retention(importance, decayedAccess(accessScore, days, tier), days, tier);

/** Days until a never-accessed fact crosses the archive threshold (core crossingDays). */
export function crossingDays(importance: number, tier: Tier): number {
  const gap = DECAY.archiveThreshold - DECAY.importanceWeight * importance;
  if (gap <= 0) return Infinity;
  return -tauDays(tier) * Math.log(gap / DECAY.recencyWeight);
}

/**
 * Days until a fact with this access score crosses, with the access score
 * itself decaying by exp(−t / τ) as the sweep does. Found by bisection on the
 * monotone score; Infinity when the floor (w_i · importance) sits above θ.
 */
export function crossingWithAccess(importance: number, accessScore: number, tier: Tier): number {
  if (DECAY.importanceWeight * importance >= DECAY.archiveThreshold) return Infinity;
  const at = (d: number) => scoreAfter(importance, accessScore, d, tier).score;
  if (at(0) < DECAY.archiveThreshold) return 0;
  let lo = 0;
  let hi = tauDays(tier);
  while (at(hi) >= DECAY.archiveThreshold) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= DECAY.archiveThreshold) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Predicates the sweep never archives (SPEC §9.2, from the registry). */
export const STATIC_PREDICATES = ['birth_date', 'is_named', 'sibling_of'];
