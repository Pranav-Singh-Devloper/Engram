import { DEFAULT_DATABASE_URL, isLocalUrl } from '@engram/core';

export interface ConsolidateArgs {
  url: string;
  hosted: boolean;
  namespace?: string;
  maxClusters?: number;
  /** Print the plan and call nothing. */
  estimate: boolean;
}

type Env = Record<string, string | undefined>;

/** Parses `jobs:consolidate` arguments. Pure, so the target rules are unit-tested. */
export function parseConsolidateArgs(args: readonly string[], env: Env): ConsolidateArgs {
  const out: Omit<ConsolidateArgs, 'url'> = { hosted: false, estimate: false };
  for (const arg of args) {
    const [flag, value] = arg.split('=', 2);
    if (flag === '--hosted' && value === undefined) out.hosted = true;
    else if (flag === '--estimate' && value === undefined) out.estimate = true;
    else if (flag === '--namespace' && value) out.namespace = value;
    else if (flag === '--max-clusters' && value && /^\d+$/.test(value)) {
      out.maxClusters = Number(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.hosted) return { ...out, url: env.DATABASE_URL || DEFAULT_DATABASE_URL };
  const url = env.HOSTED_DATABASE_URL;
  if (!url) throw new Error('HOSTED_DATABASE_URL is not set.');
  if (isLocalUrl(url)) throw new Error('--hosted points at a local database.');
  return { ...out, url };
}
