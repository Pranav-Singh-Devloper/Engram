// Configuration from the environment for the two transports (SPEC §10).
import { createHash, timingSafeEqual } from 'node:crypto';

/** Shortest accepted bearer token: long enough that guessing is hopeless. */
export const MIN_TOKEN_LENGTH = 24;

/**
 * Parses `ENGRAM_MCP_TOKENS`: comma-separated `token:slug` pairs, one
 * namespace per token. Errors never echo a token.
 */
export function parseTokens(spec: string | undefined): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [i, raw] of (spec ?? '').split(',').entries()) {
    const pair = raw.trim();
    if (pair === '') continue;
    const at = pair.lastIndexOf(':');
    const token = pair.slice(0, at).trim();
    const slug = pair.slice(at + 1).trim();
    if (at <= 0 || slug === '') {
      throw new Error(`ENGRAM_MCP_TOKENS entry ${i + 1} is not "token:namespace".`);
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `ENGRAM_MCP_TOKENS entry ${i + 1}: tokens must be at least ${MIN_TOKEN_LENGTH} characters.`,
      );
    }
    if (tokens.has(token)) throw new Error(`ENGRAM_MCP_TOKENS entry ${i + 1} repeats a token.`);
    tokens.set(token, slug);
  }
  return tokens;
}

const digest = (token: string) => createHash('sha256').update(token).digest();

/**
 * Token → namespace slug, comparing against every known token in constant
 * time so timing reveals nothing. Shared by /api/mcp and the REST endpoints
 * (P09a decision 1).
 */
export function tokenResolver(tokens: ReadonlyMap<string, string>) {
  const known = [...tokens].map(([token, slug]) => ({ digest: digest(token), slug }));
  return (token: string): string | undefined => {
    const d = digest(token);
    let found: string | undefined;
    for (const k of known) if (timingSafeEqual(d, k.digest)) found = k.slug;
    return found;
  };
}

/** The stdio server's namespace slug; one per local user or project. */
export const namespaceSlug = (env: Record<string, string | undefined>) =>
  env.ENGRAM_NAMESPACE?.trim() || 'default';
