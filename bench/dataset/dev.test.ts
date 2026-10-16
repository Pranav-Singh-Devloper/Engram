// The frozen dev split must stay valid and consistent with its own rules.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TARGETS } from './generate.js';
import { SplitFile } from './schema.js';

const file = SplitFile.parse(
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'dev.json'), 'utf8')),
);

describe('dev.json', () => {
  it('has 40 items in the target category mix', () => {
    expect(file.items).toHaveLength(40);
    for (const [category, n] of Object.entries(TARGETS.dev)) {
      expect(
        file.items.filter((i) => i.category === category),
        category,
      ).toHaveLength(n);
    }
  });

  it('records its review pass', () => {
    expect(file.review).toMatch(/Reviewed/);
  });

  it('mentions every expected answer somewhere in the setup, except abstentions', () => {
    for (const item of file.items) {
      if (item.category === 'abstention' || item.judge === 'llm') continue;
      const text = item.setup_sessions
        .flatMap((s) => s.turns)
        .join('\n')
        .toLowerCase();
      expect(text, item.id).toContain(item.expected.toLowerCase());
    }
  });

  it('asks every question after its setup', () => {
    for (const item of file.items) {
      const last = item.setup_sessions.at(-1)?.occurred_at ?? '';
      expect(item.asked_at > last, item.id).toBe(true);
    }
  });
});
