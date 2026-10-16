import { describe, expect, it } from 'vitest';
import { namesCompatible } from './names.js';

describe('namesCompatible', () => {
  it.each([
    ['Acme Robotics', 'Acme', true],
    ['Acme Corp', 'Acme Corporation', true],
    ['Rob', 'Robert', true],
    ['NYC', 'New York City', true],
    ['São Paulo', 'Sao Paulo', true],
    ['the cello', 'cello', true],
    ['Initech', 'Acme Robotics', false],
    ['Wayne Logistics', 'Initech', false],
    ['Sam', 'Sara', false],
    ['Berlin', 'Bern', false],
  ])('%s ~ %s → %s', (a, b, expected) => {
    expect(namesCompatible(a, b)).toBe(expected);
    expect(namesCompatible(b, a)).toBe(expected);
  });
});
