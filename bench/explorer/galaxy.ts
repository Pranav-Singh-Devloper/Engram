// The embedding galaxy (P09c chapter 9, decision 6): real dev-long memories,
// embedded and projected to 3D with UMAP. Turns come from the dataset (story
// or filler sessions, by persona); facts are the statements Gemini extracted
// in the dev-long session run (2026-10-18), as retrieved by recall.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { UMAP } from 'umap-js';
import { rng } from '../dataset/personas.js';
import { SplitFile } from '../dataset/schema.js';

export interface GalaxyText {
  text: string;
  kind: 'story' | 'filler' | 'fact';
  persona: string;
}

export interface GalaxyPoint extends GalaxyText {
  x: number;
  y: number;
  z: number;
}

const BENCH = path.resolve(import.meta.dirname, '..');
export const FACT_RUN = '2026-10-18-devlong-session';

export function galaxyTexts(): GalaxyText[] {
  const split = SplitFile.parse(
    JSON.parse(readFileSync(path.join(BENCH, 'dataset/dev-long.json'), 'utf8')),
  );
  const seen = new Map<string, GalaxyText>();
  for (const item of split.items) {
    for (const s of item.setup_sessions) {
      const kind = /-f\d+$/.test(s.session_id) ? 'filler' : 'story';
      for (const t of s.turns)
        if (!seen.has(t)) seen.set(t, { text: t, kind, persona: item.persona });
    }
  }
  const dir = path.join(BENCH, 'runs', FACT_RUN, 'engram');
  const personaOf = new Map(split.items.map((i) => [i.id, i.persona]));
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as {
      itemId: string;
      answer: { retrieved?: string[] };
    };
    for (const t of r.answer.retrieved ?? []) {
      if (!seen.has(t))
        seen.set(t, { text: t, kind: 'fact', persona: personaOf.get(r.itemId) ?? '' });
    }
  }
  return [...seen.values()];
}

/** Seeded UMAP to 3D, rescaled to fit a unit cube centered on the origin. */
export function project(vectors: number[][], seed = 7): [number, number, number][] {
  const umap = new UMAP({ nComponents: 3, nNeighbors: 15, minDist: 0.15, random: rng(seed) });
  const raw = umap.fit(vectors) as [number, number, number][];
  const center = [0, 1, 2].map((d) => raw.reduce((s, p) => s + (p[d] ?? 0), 0) / raw.length);
  const radius = Math.max(...raw.map((p) => Math.hypot(...p.map((v, d) => v - (center[d] ?? 0)))));
  return raw.map(
    (p) =>
      p.map((v, d) => Math.round(((v - (center[d] ?? 0)) / radius) * 1e4) / 1e4) as [
        number,
        number,
        number,
      ],
  );
}
