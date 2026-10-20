// Judge validity (SPEC §13.4, P08 decision 5): a human labels a stratified
// sample of llm-judged answers, without seeing the judge's verdict, and we
// report how often the judge agrees, with Cohen's κ.
import { rng } from '../dataset/personas.js';
import { isAbstention } from './judge.js';
import type { ItemResult } from './run.js';

export interface LabelRow {
  n: number;
  itemId: string;
  mode: string;
  category: string;
  question: string;
  expected: string;
  answer: string;
  /** The judge's verdict: kept out of the sheet the human sees. */
  judgeCorrect: boolean;
}

/** About `size` llm-judged results, round-robin across categories and modes, seeded. */
export function sampleForLabels(
  results: readonly ItemResult[],
  size: number,
  seed: number,
): LabelRow[] {
  // Only verdicts the llm judge gave: an abstention on an answerable item is
  // marked 'llm' too but was scored wrong by a rule, never sent to the judge.
  const pool = results.filter((r) => r.verdict.judge === 'llm' && !isAbstention(r.answer));
  const groups = new Map<string, ItemResult[]>();
  for (const r of [...pool].sort(
    (a, b) => a.itemId.localeCompare(b.itemId) || a.mode.localeCompare(b.mode),
  )) {
    const key = `${r.category}/${r.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const random = rng(seed);
  for (const list of groups.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j] as ItemResult, list[i] as ItemResult];
    }
  }
  const keys = [...groups.keys()].sort();
  const picked: ItemResult[] = [];
  while (picked.length < size && keys.some((k) => (groups.get(k)?.length ?? 0) > 0)) {
    for (const k of keys) {
      const next = groups.get(k)?.shift();
      if (next && picked.length < size) picked.push(next);
    }
  }
  return picked.map((r, i) => ({
    n: i + 1,
    itemId: r.itemId,
    mode: r.mode,
    category: r.category,
    question: r.question,
    expected: r.expected,
    answer: r.answer.answer,
    judgeCorrect: r.verdict.correct,
  }));
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The sheet a human fills in: no verdicts, one blank label column. */
export function renderLabelSheet(rows: readonly LabelRow[], runId: string): string {
  return [
    `# Label sheet — run ${runId}`,
    '',
    'For each row, decide whether **answer** is correct given the question and the **expected** answer, as a careful grader would: same meaning counts, extra correct detail is fine, a wrong or missing key fact is incorrect. Put `c` (correct) or `i` (incorrect) in the last column. The judge’s verdicts are hidden until you are done.',
    '',
    '| # | category | question | expected | answer | label (c/i) |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.n} | ${r.category} | ${cell(r.question)} | ${cell(r.expected)} | ${cell(r.answer)} |  |`,
    ),
    '',
  ].join('\n');
}

/** Reads the human labels back: row number → correct? Unlabelled rows are absent. */
export function parseLabels(sheet: string): Map<number, boolean> {
  const labels = new Map<number, boolean>();
  for (const line of sheet.split('\n')) {
    const m = /^\|\s*(\d+)\s*\|.*\|\s*([ciCI])\s*\|\s*$/.exec(line);
    if (m) labels.set(Number(m[1]), m[2]?.toLowerCase() === 'c');
  }
  return labels;
}

export interface Agreement {
  n: number;
  agreement: number;
  /** null when judge and human each used one class only: κ is undefined there. */
  kappa: number | null;
  /** Labelled-correct and labelled-incorrect counts, for reading κ in context. */
  humanCorrect: number;
  humanIncorrect: number;
  /** Judge said correct, human said incorrect; and the reverse. */
  judgeTooLenient: number;
  judgeTooStrict: number;
}

export interface LabelPair {
  judge: boolean;
  human: boolean;
}

/** The (judge, human) pairs for the rows a human labelled. */
export function labelPairs(
  rows: readonly LabelRow[],
  labels: ReadonlyMap<number, boolean>,
): LabelPair[] {
  return rows.flatMap((r) => {
    const human = labels.get(r.n);
    return human === undefined ? [] : [{ judge: r.judgeCorrect, human }];
  });
}

/** Agreement and Cohen's κ between judge and human on the labelled rows. */
export function agreement(
  rows: readonly LabelRow[],
  labels: ReadonlyMap<number, boolean>,
): Agreement {
  return agreementOf(labelPairs(rows, labels));
}

/** The same over any pairs, e.g. several runs' sheets pooled. */
export function agreementOf(pairs: readonly LabelPair[]): Agreement {
  const n = pairs.length;
  const humanCorrect = pairs.filter((p) => p.human).length;
  if (n === 0) {
    return {
      n: 0,
      agreement: 0,
      kappa: null,
      humanCorrect: 0,
      humanIncorrect: 0,
      judgeTooLenient: 0,
      judgeTooStrict: 0,
    };
  }
  const agree = pairs.filter((p) => p.judge === p.human).length;
  const po = agree / n;
  const pJudge = pairs.filter((p) => p.judge).length / n;
  const pHuman = pairs.filter((p) => p.human).length / n;
  const pe = pJudge * pHuman + (1 - pJudge) * (1 - pHuman);
  return {
    n,
    agreement: po,
    // With one class on both sides, chance agreement is 1 and κ is 0/0.
    kappa: pe === 1 ? null : (po - pe) / (1 - pe),
    humanCorrect,
    humanIncorrect: n - humanCorrect,
    judgeTooLenient: pairs.filter((p) => p.judge && !p.human).length,
    judgeTooStrict: pairs.filter((p) => !p.judge && p.human).length,
  };
}
