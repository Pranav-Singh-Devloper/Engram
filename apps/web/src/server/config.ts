// The web app's settings, read once from the environment (.env.example).
import { parseTokens, tokenResolver } from '@engram/mcp';
import type { AuthConfig } from './auth';

export interface WebConfig extends AuthConfig {
  /** Keys the per-IP throttle's HMAC; IPs are never stored (P09a decision 4). */
  ipHashSecret: string;
  /** Demo chat turns per UTC day across all demo namespaces. */
  dailyTurnCap: number;
  /** Secure cookies need HTTPS; local `next dev` is plain http. */
  secureCookies: boolean;
}

type Env = Record<string, string | undefined>;

export function configFromEnv(env: Env): WebConfig {
  const production = env.NODE_ENV === 'production';
  const ipHashSecret = env.ENGRAM_IP_HASH_SECRET?.trim() ?? '';
  if (production && ipHashSecret.length < 16) {
    throw new Error('ENGRAM_IP_HASH_SECRET must be set (16+ characters) in production.');
  }
  const cap = Number(env.ENGRAM_DEMO_DAILY_TURNS ?? 120);
  return {
    resolveToken: tokenResolver(parseTokens(env.ENGRAM_MCP_TOKENS)),
    showcaseSlug: env.ENGRAM_SHOWCASE_NAMESPACE?.trim() || undefined,
    ipHashSecret: ipHashSecret || 'local-development-only',
    dailyTurnCap: Number.isFinite(cap) && cap >= 0 ? cap : 120,
    secureCookies: production,
  };
}
