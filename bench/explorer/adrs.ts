// Parses DECISIONS.md into structured ADRs for the explorer's decision log
// (P09c chapter 15). The Markdown subset is the one the file uses: headings,
// **Label.** section starts, paragraphs, nested bullet and numbered lists,
// and pipe tables. Inline formatting stays as Markdown for the page to render.

export type Block =
  | { type: 'p'; text: string }
  | { type: 'list'; ordered: boolean; items: { text: string; level: number }[] }
  | { type: 'table'; header: string[]; rows: string[][] };

export interface Adr {
  id: string;
  number: number;
  title: string;
  date: string;
  status: string;
  sections: { label: string; blocks: Block[] }[];
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const row = cells(lines[i] ?? '');
        if (!row.every((c) => /^:?-+:?$/.test(c))) rows.push(row);
        i++;
      }
      const [header = [], ...rest] = rows;
      out.push({ type: 'table', header, rows: rest });
      continue;
    }
    const item = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2] ?? '');
      const items: { text: string; level: number }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(lines[i] ?? '');
        if (m) {
          items.push({ text: m[3] ?? '', level: Math.floor((m[1]?.length ?? 0) / 2) });
          i++;
        } else if (
          (lines[i] ?? '').startsWith('  ') &&
          items.length > 0 &&
          (lines[i] ?? '').trim() !== ''
        ) {
          const last = items[items.length - 1];
          if (last) last.text += ` ${(lines[i] ?? '').trim()}`;
          i++;
        } else break;
      }
      out.push({ type: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(\s*)(-|\d+\.)\s|^\s*\|/.test(lines[i] ?? '')
    ) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    out.push({ type: 'p', text: para.join(' ') });
  }
  return out;
}

export function parseAdrs(md: string): Adr[] {
  const parts = md.split(/^## (?=ADR-\d+)/m).slice(1);
  return parts.map((part) => {
    const [head = '', ...rest] = part.split('\n');
    const m = /^(ADR-(\d+))\s+[—-]\s+(.*)$/.exec(head.trim());
    if (!m) throw new Error(`Unparsable ADR heading: ${head}`);
    const body = rest.join('\n').split(/^---\s*$/m)[0] ?? '';
    const meta = /\*\*Date:\*\*\s*([\d-]+)\s*·\s*\*\*Status:\*\*\s*([^\n]+)/.exec(body);
    const lines = body.split('\n').filter((l) => !/^\*\*Date:\*\*/.test(l));
    // Sections start at a paragraph opening with **Label.**; text before the first is "Summary".
    const sections: { label: string; lines: string[] }[] = [{ label: 'Summary', lines: [] }];
    for (const l of lines) {
      const s = /^\*\*([^*]+?)\.\*\*\s*(.*)$/.exec(l);
      if (s) sections.push({ label: s[1] ?? '', lines: s[2] ? [s[2]] : [] });
      else sections[sections.length - 1]?.lines.push(l);
    }
    return {
      id: m[1] ?? '',
      number: Number(m[2]),
      title: m[3] ?? '',
      date: meta?.[1] ?? '',
      status: meta?.[2]?.trim() ?? '',
      sections: sections
        .map((s) => ({ label: s.label, blocks: blocks(s.lines) }))
        .filter((s) => s.blocks.length > 0),
    };
  });
}
