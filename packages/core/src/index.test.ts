import { describe, expect, it } from 'vitest';
import { ENGRAM_VERSION } from './index.js';

describe('@engram/core', () => {
  it('exports a semver version string', () => {
    expect(ENGRAM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
