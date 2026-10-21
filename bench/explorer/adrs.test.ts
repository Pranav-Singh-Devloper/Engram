import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAdrs } from './adrs.js';

const md = readFileSync(path.resolve(import.meta.dirname, '../../DECISIONS.md'), 'utf8');

describe('parseAdrs', () => {
  const adrs = parseAdrs(md);

  it('finds every ADR in DECISIONS.md, in order, each with a date, status and decision', () => {
    const headings = md.match(/^## ADR-\d+/gm) ?? [];
    expect(adrs).toHaveLength(headings.length);
    expect(adrs.map((a) => a.number)).toEqual(adrs.map((_, i) => i + 1));
    for (const a of adrs) {
      expect(a.date, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.status, a.id).not.toBe('');
      expect(
        a.sections.some((s) => s.label.startsWith('Decision')),
        a.id,
      ).toBe(true);
    }
  });

  it('keeps tables and nested lists', () => {
    const adr18 = adrs.find((a) => a.id === 'ADR-018');
    const blocks = adr18?.sections.flatMap((s) => s.blocks) ?? [];
    const table = blocks.find((b) => b.type === 'table');
    expect(table?.type === 'table' && table.header).toEqual(['option', 'why not']);
    const list = blocks.find((b) => b.type === 'list');
    expect(list?.type === 'list' && list.items.length).toBeGreaterThan(1);
  });

  it('parses a small sample exactly', () => {
    const [a] = parseAdrs(
      `# x\n\n## ADR-001 — Title here\n\n**Date:** 2026-01-02 · **Status:** Accepted\n\n**Context.** Why.\n\n**Decision.**\n\n- one\n  - nested\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n`,
    );
    expect(a).toEqual({
      id: 'ADR-001',
      number: 1,
      title: 'Title here',
      date: '2026-01-02',
      status: 'Accepted',
      sections: [
        { label: 'Context', blocks: [{ type: 'p', text: 'Why.' }] },
        {
          label: 'Decision',
          blocks: [
            {
              type: 'list',
              ordered: false,
              items: [
                { text: 'one', level: 0 },
                { text: 'nested', level: 1 },
              ],
            },
            { type: 'table', header: ['a', 'b'], rows: [['1', '2']] },
          ],
        },
      ],
    });
  });
});
