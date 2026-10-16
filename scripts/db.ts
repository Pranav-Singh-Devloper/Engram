import postgres from 'postgres';
import type { Sql } from 'postgres';

export const DEFAULT_DATABASE_URL = 'postgres://engram:engram@localhost:54329/engram';

/** Every Engram connection resolves unqualified names in this order (SPEC §5). */
export const SEARCH_PATH = 'engram, extensions, public';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalUrl(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

export function connect(url: string): Sql {
  return postgres(url, {
    max: 1,
    ssl: isLocalUrl(url) ? false : 'require',
    onnotice: () => undefined,
    connection: { search_path: SEARCH_PATH },
  });
}

export interface MigrateTarget {
  url: string;
  hosted: boolean;
  reset: boolean;
}

type Env = Record<string, string | undefined>;

/** Decides which database `migrate.ts` touches. Pure, so the safety rules are unit-tested. */
export function resolveTarget(args: readonly string[], env: Env): MigrateTarget {
  const unknown = args.filter((a) => a !== '--hosted' && a !== '--reset');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(' ')}`);
  }
  const hosted = args.includes('--hosted');
  const reset = args.includes('--reset');

  if (hosted && reset) {
    throw new Error('--reset is local-only and cannot be combined with --hosted.');
  }

  if (hosted) {
    const url = env.HOSTED_DATABASE_URL;
    if (!url) {
      throw new Error('HOSTED_DATABASE_URL is not set.');
    }
    if (isLocalUrl(url)) {
      throw new Error('Refusing to apply hosted-only SQL to a local database.');
    }
    return { url, hosted, reset };
  }

  const url = env.DATABASE_URL || DEFAULT_DATABASE_URL;
  if (reset && !isLocalUrl(url)) {
    throw new Error('Refusing to reset a non-local database.');
  }
  return { url, hosted, reset };
}
