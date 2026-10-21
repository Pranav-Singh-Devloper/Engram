// pnpm explorer:data [--skip-galaxy] [--skip-consolidation]
// Writes the architecture explorer's build-time data (P09c decision 3) to
// apps/web/src/content/generated/: the parsed ADRs, the calibration summaries
// and the embedding galaxy. The page reads only these committed files, so it
// can't drift from the repo and needs no database or model calls to render.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, makeProviders } from '../runner/providers.js';
import { parseAdrs } from './adrs.js';
import { CONSOLIDATION_ITEM, consolidationStory, floorRuns } from './chapters.js';
import { bitemporal, cases, recallTraces, writePath } from './engine-data.js';
import { FACT_RUN, galaxyTexts, project } from './galaxy.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'apps/web/src/content/generated');

const write = (name: string, data: unknown) => {
  writeFileSync(path.join(OUT, name), `${JSON.stringify(data)}\n`);
  console.log(`wrote ${path.relative(ROOT, path.join(OUT, name))}`);
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  write('adrs.json', parseAdrs(readFileSync(path.join(ROOT, 'DECISIONS.md'), 'utf8')));

  const calDir = path.join(ROOT, 'bench/calibration');
  write(
    'calibration.json',
    readdirSync(calDir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.scores.json'))
      .sort()
      .map((f) => {
        const summary = JSON.parse(readFileSync(path.join(calDir, f), 'utf8')) as Record<
          string,
          unknown
        >;
        const scoresFile = path.join(calDir, f.replace(/\.json$/, '.scores.json'));
        const scores = existsSync(scoresFile)
          ? (JSON.parse(readFileSync(scoresFile, 'utf8')) as { scores: unknown }).scores
          : null;
        return { ...summary, scores };
      }),
  );

  write('writepath.json', writePath());
  write('cases.json', cases());
  // Replays the story through the engine on the local database (pnpm db:up).
  write('bitemporal.json', await bitemporal());

  loadEnv();
  const { gemini } = makeProviders();
  // Real Gemini embeddings for ~30 texts, cached per text after the first run.
  write('recall.json', { ...(await recallTraces(gemini)), floors: floorRuns() });
  if (!process.argv.includes('--skip-consolidation')) {
    // One dev-long history through engram_consolidated on Gemini: ~20 generate
    // calls on a cold cache, none when the bench cache already holds them.
    console.log(`consolidating ${CONSOLIDATION_ITEM} through the engine`);
    write('consolidation.json', await consolidationStory(makeProviders().system));
  }

  if (process.argv.includes('--skip-galaxy')) return;
  const texts = galaxyTexts();
  console.log(
    `embedding ${String(texts.length)} texts with ${await gemini.embeddingSpace()} (per-text cache)`,
  );
  const vectors = await gemini.embed(
    texts.map((t) => t.text),
    { purpose: 'document' },
  );
  const coords = project(vectors);
  write('galaxy.json', {
    space: await gemini.embeddingSpace(),
    method: 'UMAP to 3D: 15 neighbors, min distance 0.15, seed 7',
    source: `dev-long turns (story and filler sessions) and the facts recalled in run ${FACT_RUN}`,
    points: texts.map((t, i) => {
      const [x, y, z] = coords[i] ?? [0, 0, 0];
      return { ...t, text: t.text.length > 220 ? `${t.text.slice(0, 217)}…` : t.text, x, y, z };
    }),
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
