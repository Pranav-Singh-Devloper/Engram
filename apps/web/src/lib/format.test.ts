import { UNKNOWN_START } from '@engram/core';
import { describe, expect, it } from 'vitest';
import { UNKNOWN_START_MS, formatWindow } from './format';

describe('format', () => {
  it("mirrors core's UNKNOWN_START exactly", () => {
    expect(UNKNOWN_START_MS).toBe(UNKNOWN_START.getTime());
  });

  it('formats open, closed and unknown-start windows', () => {
    const mar = new Date('2024-03-01T00:00:00Z');
    expect(formatWindow(mar, null)).toBe('Mar 2024 → now');
    expect(formatWindow(new Date(UNKNOWN_START_MS), new Date('2018-01-01T00:00:00Z'))).toBe(
      'unknown → Jan 2018',
    );
    expect(formatWindow(mar, new Date('2024-06-10T00:00:00Z'), true)).toBe(
      '1 Mar 2024 → 10 Jun 2024',
    );
  });
});
