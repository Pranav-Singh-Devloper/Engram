// dev-long must differ from dev only by filler: same questions and answers,
// the same fact turns, and filler only before each question.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SplitFile } from './schema.js';

const load = (name: string) =>
  SplitFile.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, name), 'utf8')));
const dev = load('dev.json');
const long = load('dev-long.json');

describe('dev-long.json', () => {
  it('asks the same questions, expecting the same answers', () => {
    expect(long.items.map((i) => [i.id, i.question, i.expected, i.valid_at, i.known_at])).toEqual(
      dev.items.map((i) => [i.id, i.question, i.expected, i.valid_at, i.known_at]),
    );
  });

  it('keeps every fact session word for word, and adds filler only before the question', () => {
    for (const [i, item] of long.items.entries()) {
      const devItem = dev.items[i];
      const facts = item.setup_sessions.filter((s) => !/-f\d+$/.test(s.session_id));
      expect(facts, item.id).toEqual(devItem?.setup_sessions);
      const filler = item.setup_sessions.filter((s) => /-f\d+$/.test(s.session_id));
      expect(filler.length, item.id).toBeGreaterThan(0);
      for (const f of filler) expect(f.occurred_at < item.asked_at, item.id).toBe(true);
    }
  });

  it('roughly doubles the history beyond the buffer window', () => {
    const turns = long.items
      .filter((i) => i.category !== 'single_session_recall')
      .map((i) => i.setup_sessions.reduce((n, s) => n + s.turns.length, 0));
    expect(Math.min(...turns)).toBeGreaterThan(30);
  });
});
