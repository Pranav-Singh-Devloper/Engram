import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATABASE_URL } from '@engram/core';
import { describe, expect, it } from 'vitest';
import { parseConsolidateArgs, parseMaintainArgs } from './jobs.js';

const HOSTED = 'postgres://u:p@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

describe('jobs:consolidate arguments', () => {
  it('targets the local database by default', () => {
    expect(parseConsolidateArgs([], {})).toEqual({
      url: DEFAULT_DATABASE_URL,
      hosted: false,
      estimate: false,
    });
  });

  it('parses the namespace, the cap and estimate-only', () => {
    expect(
      parseConsolidateArgs(['--namespace=demo-1', '--max-clusters=3', '--estimate'], {}),
    ).toMatchObject({ namespace: 'demo-1', maxClusters: 3, estimate: true });
  });

  it('needs a non-local HOSTED_DATABASE_URL for --hosted', () => {
    expect(parseConsolidateArgs(['--hosted'], { HOSTED_DATABASE_URL: HOSTED }).url).toBe(HOSTED);
    expect(() => parseConsolidateArgs(['--hosted'], {})).toThrow(/not set/);
    expect(() =>
      parseConsolidateArgs(['--hosted'], { HOSTED_DATABASE_URL: DEFAULT_DATABASE_URL }),
    ).toThrow(/local/);
  });

  it('rejects unknown or malformed arguments', () => {
    expect(() => parseConsolidateArgs(['--max-clusters=many'], {})).toThrow(/Unknown/);
    expect(() => parseConsolidateArgs(['--all'], {})).toThrow(/Unknown/);
  });
});

describe('jobs:maintain arguments', () => {
  it('accepts only --hosted, with the same target rules', () => {
    expect(parseMaintainArgs([], {})).toEqual({ url: DEFAULT_DATABASE_URL, hosted: false });
    expect(parseMaintainArgs(['--hosted'], { HOSTED_DATABASE_URL: HOSTED })).toEqual({
      url: HOSTED,
      hosted: true,
    });
    expect(() => parseMaintainArgs(['--estimate'], {})).toThrow(/Unknown/);
    expect(() =>
      parseMaintainArgs(['--hosted'], { HOSTED_DATABASE_URL: DEFAULT_DATABASE_URL }),
    ).toThrow(/local/);
  });
});

describe('nightly workflow', () => {
  const workflow = readFileSync(
    path.resolve(import.meta.dirname, '../.github/workflows/nightly.yml'),
    'utf8',
  );

  it('runs maintenance, then consolidation', () => {
    expect(workflow.indexOf('pnpm jobs:maintain --hosted')).toBeGreaterThan(0);
    expect(workflow.indexOf('pnpm jobs:consolidate --hosted')).toBeGreaterThan(
      workflow.indexOf('pnpm jobs:maintain --hosted'),
    );
  });

  it('runs nightly and on dispatch', () => {
    expect(workflow).toMatch(/schedule:[^]*?- cron: '[^']+'/);
    expect(workflow).toContain('workflow_dispatch:');
  });

  it('skips every real step when the hosted database secret is unset', () => {
    const steps = workflow.split('\n      - ').slice(1);
    const [notice, ...rest] = steps;
    expect(notice).toContain("if: env.HOSTED_DATABASE_URL == ''");
    expect(rest.length).toBeGreaterThan(0);
    for (const step of rest) expect(step).toContain("if: env.HOSTED_DATABASE_URL != ''");
  });
});
