// The README's benchmark tables are exactly what the committed reports say.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { END, START, renderBenchTables, withTables } from './docs-tables.js';

const README = path.resolve(import.meta.dirname, '../README.md');

describe('README bench tables', () => {
  it('are current: regenerating them changes nothing', () => {
    const readme = readFileSync(README, 'utf8');
    expect(readme).toContain(START);
    expect(withTables(readme)).toBe(readme);
  });

  it('carry the headline numbers, losses included', () => {
    const block = renderBenchTables();
    // Test split: Engram 199/200; LongMemEval: rag and full_context ahead of Engram.
    expect(block).toContain('(199/200)');
    expect(block).toMatch(
      /\| \*\*all\*\* \| 98 \| \*\*8%\*\* .* \| \*\*52%\*\* .* \| \*\*54%\*\* .* \| \*\*45%\*\*/,
    );
  });

  it('refuses a README without markers', () => {
    expect(() => withTables('# no markers', 'x')).toThrow(/markers/);
    expect(withTables(`a\n${START}\nold\n${END}\nb`, 'new')).toBe(
      `a\n${START}\n<!-- prettier-ignore-start -->\n\nnew\n\n<!-- prettier-ignore-end -->\n${END}\nb`,
    );
  });
});
