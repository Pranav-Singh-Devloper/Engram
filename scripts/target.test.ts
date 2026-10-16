import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL } from '@engram/core';
import { resolveTarget } from './target.js';

const HOSTED_URL = 'postgres://postgres.ref:pw@aws-0-region.pooler.supabase.com:5432/postgres';

describe('resolveTarget', () => {
  it('defaults to the local compose database', () => {
    expect(resolveTarget([], {})).toEqual({
      url: DEFAULT_DATABASE_URL,
      hosted: false,
      reset: false,
    });
  });

  it('uses DATABASE_URL when set', () => {
    const url = 'postgres://u:p@localhost:6000/other';
    expect(resolveTarget([], { DATABASE_URL: url }).url).toBe(url);
  });

  it('uses HOSTED_DATABASE_URL for --hosted', () => {
    expect(resolveTarget(['--hosted'], { HOSTED_DATABASE_URL: HOSTED_URL })).toMatchObject({
      url: HOSTED_URL,
      hosted: true,
    });
  });

  it('--hosted refuses a local URL', () => {
    expect(() =>
      resolveTarget(['--hosted'], { HOSTED_DATABASE_URL: DEFAULT_DATABASE_URL }),
    ).toThrow(/local database/);
  });

  it('--hosted requires HOSTED_DATABASE_URL', () => {
    expect(() => resolveTarget(['--hosted'], { DATABASE_URL: HOSTED_URL })).toThrow(
      /HOSTED_DATABASE_URL/,
    );
  });

  it('--reset refuses a non-local URL', () => {
    expect(() => resolveTarget(['--reset'], { DATABASE_URL: HOSTED_URL })).toThrow(/non-local/);
  });

  it('rejects --hosted with --reset', () => {
    expect(() =>
      resolveTarget(['--hosted', '--reset'], { HOSTED_DATABASE_URL: HOSTED_URL }),
    ).toThrow(/cannot be combined/);
  });

  it('rejects unknown arguments', () => {
    expect(() => resolveTarget(['--force'], {})).toThrow(/Unknown argument/);
  });
});
