import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resultFiles } from './run.js';

describe('resultFiles', () => {
  it('reads item results from mode folders, never run-level files', () => {
    // Measured 2026-10-19: provider-stats.json at the run's top level was read
    // as an item result and crashed bench:label; labels-key.json lives there too.
    const dir = mkdtempSync(path.join(tmpdir(), 'engram-run-'));
    mkdirSync(path.join(dir, 'engram'));
    writeFileSync(path.join(dir, 'engram', 'dev-001.json'), '{}');
    writeFileSync(path.join(dir, 'provider-stats.json'), '{}');
    writeFileSync(path.join(dir, 'labels-key.json'), '[]');
    expect(resultFiles(dir).map((f) => path.relative(dir, f))).toEqual([
      path.join('engram', 'dev-001.json'),
    ]);
    rmSync(dir, { recursive: true });
  });
});
