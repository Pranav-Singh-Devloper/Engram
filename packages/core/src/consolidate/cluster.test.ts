import { describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { basisVector } from '../testing/db.js';
import { splitSession } from './cluster.js';
import type { ClusterTurn } from './cluster.js';

let n = 0;
const turn = (embedding: number[] | null, over: Partial<ClusterTurn> = {}): ClusterTurn => ({
  id: `t${++n}`,
  sessionId: 's1',
  role: 'user',
  content: `turn ${n}`,
  occurredAt: new Date(Date.UTC(2024, 0, 1, 9, n)),
  importance: 0.5,
  embedding,
  ...over,
});

describe('splitSession', () => {
  it('keeps a coherent session together', () => {
    const turns = [turn(basisVector(1)), turn(basisVector(1)), turn(basisVector(1))];
    expect(splitSession(turns).map((c) => c.length)).toEqual([3]);
  });

  it('splits where the conversation drifts', () => {
    const turns = [
      turn(basisVector(1)),
      turn(basisVector(1)),
      turn(basisVector(2)),
      turn(basisVector(2)),
    ];
    expect(splitSession(turns).map((c) => c.length)).toEqual([2, 2]);
  });

  it('caps a cluster at the configured size', () => {
    const turns = Array.from({ length: config.consolidation.maxClusterSize + 3 }, () =>
      turn(basisVector(1)),
    );
    expect(splitSession(turns).map((c) => c.length)).toEqual([
      config.consolidation.maxClusterSize,
      3,
    ]);
  });

  it('does not split on a missing embedding', () => {
    expect(
      splitSession([turn(basisVector(1)), turn(null), turn(basisVector(1))]).map((c) => c.length),
    ).toEqual([3]);
  });
});
