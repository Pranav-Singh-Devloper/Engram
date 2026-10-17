import { describe, expect, it } from 'vitest';
import { namespaceSlug, parseTokens } from './env.js';

const A = 'a'.repeat(24);
const B = 'b-token-with:colons-inside-0123';

describe('parseTokens', () => {
  it('maps each token to its namespace; the last colon splits', () => {
    expect([...parseTokens(` ${A}:alice , ${B}:bob,`)]).toEqual([
      [A, 'alice'],
      [B, 'bob'],
    ]);
    expect(parseTokens(undefined).size).toBe(0);
  });

  it('rejects malformed, short and repeated tokens without echoing them', () => {
    for (const spec of [A, `${A}:`, 'short-token:alice', `${A}:x,${A}:y`]) {
      let message = '';
      try {
        parseTokens(spec);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, spec).toMatch(/ENGRAM_MCP_TOKENS entry \d/);
      expect(message).not.toContain('short-token');
      expect(message).not.toContain(A);
    }
  });
});

describe('namespaceSlug', () => {
  it('reads ENGRAM_NAMESPACE, defaulting to "default"', () => {
    expect(namespaceSlug({ ENGRAM_NAMESPACE: ' me ' })).toBe('me');
    expect(namespaceSlug({})).toBe('default');
  });
});
