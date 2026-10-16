import { describe, expect, it } from 'vitest';
import { isLocalUrl } from './client.js';

const HOSTED_URL = 'postgres://postgres.ref:pw@aws-0-region.pooler.supabase.com:5432/postgres';

describe('isLocalUrl', () => {
  it.each([
    ['postgres://u:p@localhost:54329/db', true],
    ['postgres://u:p@127.0.0.1:5432/db', true],
    ['postgres://u:p@[::1]:5432/db', true],
    [HOSTED_URL, false],
    ['postgres://u:p@localhost.example.com/db', false],
  ])('%s → %s', (url, expected) => {
    expect(isLocalUrl(url)).toBe(expected);
  });
});
