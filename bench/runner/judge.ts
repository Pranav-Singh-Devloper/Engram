// Judges (SPEC §13.4). `exact` and `contains` are deterministic; `llm` asks
// the judge provider (a different model family). Abstention items expect
// "I don't know" and are correct exactly when the system abstained.
import type { Provider } from '@engram/core';
import type { BenchItem, JudgeKind } from '../dataset/schema.js';
import { ABSTAIN } from '../dataset/questions.js';

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAbstention(answer: { answer: string; supported: boolean }): boolean {
  if (!answer.supported) return true;
  return /\b(i )?(do not|don t|dont) know\b|\bno (information|record)\b/.test(
    normalize(answer.answer),
  );
}

export interface Verdict {
  correct: boolean;
  judge: JudgeKind | 'abstention';
  reason: string;
}

export async function judgeAnswer(
  item: BenchItem,
  answer: { answer: string; supported: boolean },
  llm?: Pick<Provider, 'judge'>,
): Promise<Verdict> {
  const abstained = isAbstention(answer);
  // Our splits mark unanswerable items with the ABSTAIN sentinel; LongMemEval's
  // keep an explanation as `expected`, so the category decides too.
  if (item.expected === ABSTAIN || item.category === 'abstention') {
    return {
      correct: abstained,
      judge: 'abstention',
      reason: abstained ? 'abstained' : 'answered an unanswerable question',
    };
  }
  if (abstained)
    return { correct: false, judge: item.judge, reason: 'abstained on an answerable question' };

  const got = normalize(answer.answer);
  const want = normalize(item.expected);
  switch (item.judge) {
    case 'exact':
      return {
        correct: got === want,
        judge: 'exact',
        reason: got === want ? 'exact match' : 'no exact match',
      };
    case 'contains':
      return {
        correct: got.includes(want),
        judge: 'contains',
        reason: got.includes(want) ? 'contains expected' : 'expected value missing',
      };
    case 'llm': {
      if (!llm) {
        // Without an LLM judge (offline smoke), fall back to containment.
        return {
          correct: got.includes(want),
          judge: 'contains',
          reason: 'llm judge unavailable; containment',
        };
      }
      const v = await llm.judge({
        question: item.question,
        expected: item.expected,
        answer: answer.answer,
      });
      return { correct: v.correct, judge: 'llm', reason: v.reason };
    }
  }
}
