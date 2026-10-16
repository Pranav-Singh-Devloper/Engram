// Manual check against the real Gemini API (P01 DoD). Makes 2-3 requests:
// lists models, embeds three texts, and optionally tests JSON generation.
// Run with `pnpm gemini:check`; needs GEMINI_API_KEY in .env.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GEMINI_BASE_URL, GeminiProvider, cosine, geminiKeysFromEnv } from '@engram/core';

const envFile = path.resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const embedModel = process.env.GEMINI_EMBED_MODEL || undefined;
const chatModel = process.env.GEMINI_CHAT_MODEL || undefined;

const Models = z.object({
  models: z.array(
    z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() }),
  ),
});

async function main(): Promise<void> {
  const keys = geminiKeysFromEnv(process.env);
  const provider = new GeminiProvider({ ...keys, embedModel, chatModel });

  // Listing models doesn't count against the generate quota, so every key is
  // validated for free; only the main key runs the paid checks below.
  let models: z.infer<typeof Models>['models'] = [];
  for (const [i, key] of [keys.apiKey, ...keys.fallbackApiKeys].entries()) {
    const res = await fetch(`${GEMINI_BASE_URL}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': key },
    });
    if (!res.ok) throw new Error(`Key ${i} failed to list models: HTTP ${res.status}`);
    const listed = Models.parse(await res.json()).models;
    console.log(`key ${i}${i === 0 ? ' (main)' : ' (fallback)'}: valid, ${listed.length} models`);
    if (i === 0) models = listed;
  }
  const supports = (m: (typeof models)[number], method: string) =>
    m.supportedGenerationMethods?.includes(method) ?? false;
  console.log(
    'embedding models:',
    models
      .filter((m) => supports(m, 'embedContent'))
      .map((m) => m.name)
      .join(', '),
  );
  console.log(
    'flash models:',
    models
      .filter((m) => supports(m, 'generateContent') && m.name.includes('flash'))
      .map((m) => m.name)
      .join(', '),
  );

  const docs = ['Sam moved to Berlin in March.', 'The user prefers green tea.'];
  const [berlin, tea] = await provider.embed(docs, { purpose: 'document' });
  const [query] = await provider.embed(['Where does Sam live now?'], { purpose: 'query' });
  if (!berlin || !tea || !query) throw new Error('Missing vectors');
  const related = cosine(query, berlin);
  const unrelated = cosine(query, tea);
  console.log(`embed: dims ${query.length}, norm ${Math.hypot(...query).toFixed(6)}`);
  console.log(
    `embed: cos(query, Berlin) ${related.toFixed(3)} vs cos(query, tea) ${unrelated.toFixed(3)}`,
  );
  if (related <= unrelated)
    throw new Error('Embedding check failed: unrelated text scored higher.');

  if (chatModel) {
    const out = await provider.generate({
      system: 'Extract the city. Reply with JSON {"city": string}.',
      user: 'Sam moved to Berlin in March.',
      schema: z.object({ city: z.string() }),
    });
    console.log(`generate (${chatModel}):`, out);
  } else {
    console.log('generate: skipped (set GEMINI_CHAT_MODEL to check JSON generation)');
  }
  console.log('ok');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
