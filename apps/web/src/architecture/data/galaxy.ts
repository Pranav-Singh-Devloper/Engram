// The embedding galaxy (bench explorer:data): real dev-long turns and recalled
// facts, embedded with Gemini and projected to 3D with seeded UMAP.
import raw from '@/content/generated/galaxy.json';

export type GalaxyKind = 'story' | 'filler' | 'fact';

export interface GalaxyPoint {
  text: string;
  kind: GalaxyKind;
  persona: string;
  x: number;
  y: number;
  z: number;
}

export const GALAXY = raw as {
  space: string;
  method: string;
  source: string;
  points: GalaxyPoint[];
};

export const PERSONAS = [...new Set(GALAXY.points.map((p) => p.persona))].sort();

const dist = (a: GalaxyPoint, b: GalaxyPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Each point's k nearest neighbours in the projection, by index. */
export function neighbours(points: readonly GalaxyPoint[], k: number): number[][] {
  return points.map((p, i) =>
    points
      .map((q, j) => ({ j, d: j === i ? Infinity : dist(p, q) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((n) => n.j),
  );
}

/**
 * Per kind: the share of each point's k nearest neighbours that share its kind,
 * and the share that share its persona (chance is 1 / personas).
 */
export function neighbourStats(points: readonly GalaxyPoint[], k = 5) {
  const nn = neighbours(points, k);
  const kinds: GalaxyKind[] = ['story', 'fact', 'filler'];
  return kinds.map((kind) => {
    const own = points.flatMap((p, i) => (p.kind === kind ? [i] : []));
    const share = (same: (a: GalaxyPoint, b: GalaxyPoint) => boolean) =>
      own.reduce((s, i) => {
        const p = points[i];
        return s + (nn[i] ?? []).filter((j) => p && points[j] && same(p, points[j])).length;
      }, 0) / Math.max(1, own.length * k);
    return {
      kind,
      n: own.length,
      sameKind: share((a, b) => a.kind === b.kind),
      samePersona: share((a, b) => a.persona === b.persona),
    };
  });
}
