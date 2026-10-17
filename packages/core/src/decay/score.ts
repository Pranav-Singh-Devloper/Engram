// The retention score (SPEC §9.1), mirrored in TS for tests and the
// dashboard. The decay sweep computes the same thing in SQL with the same
// parameters from `config`.
//
//   score = w_r · exp(−days_since_last_access / τ_tier)
//         + w_a · min(1, ln(1 + access_score) / ln(1 + saturation))
//         + w_i · importance
//
// As recency and access decay to zero the score approaches w_i · importance,
// so a non-pinned fact is archivable by decay iff importance < θ / w_i (0.6).
import { config } from '../config/index.js';
import type { FactTier } from '../types/index.js';

const DAY = 86_400_000;

type DecayConfig = typeof config.decay;

export function tauDays(tier: FactTier, cfg: DecayConfig = config.decay): number {
  return tier === 'long_term' ? cfg.tauLongTermDays : cfg.tauWorkingDays;
}

export interface RetentionInput {
  importance: number;
  accessScore: number;
  lastAccessedAt: Date | null;
  recordedAt: Date;
  tier: FactTier;
}

export function retentionScore(
  f: RetentionInput,
  now: Date,
  cfg: DecayConfig = config.decay,
): number {
  const since = f.lastAccessedAt ?? f.recordedAt;
  const days = Math.max(0, (now.getTime() - since.getTime()) / DAY);
  const recency = Math.exp(-days / tauDays(f.tier, cfg));
  const access = Math.min(1, Math.log(1 + f.accessScore) / Math.log(1 + cfg.accessSaturation));
  return (
    cfg.recencyWeight * recency + cfg.accessWeight * access + cfg.importanceWeight * f.importance
  );
}

/** access_score after Δt days of decay: access_score · exp(−Δt / τ_tier). */
export function decayedAccess(
  score: number,
  dtDays: number,
  tier: FactTier,
  cfg: DecayConfig = config.decay,
): number {
  return score * Math.exp(-dtDays / tauDays(tier, cfg));
}

/** Days until a never-accessed fact's score crosses the archive threshold (Infinity if never). */
export function crossingDays(
  importance: number,
  tier: FactTier,
  cfg: DecayConfig = config.decay,
): number {
  const gap = cfg.archiveThreshold - cfg.importanceWeight * importance;
  if (gap <= 0) return Infinity;
  return -tauDays(tier, cfg) * Math.log(gap / cfg.recencyWeight);
}
