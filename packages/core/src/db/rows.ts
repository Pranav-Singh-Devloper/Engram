import type { SerializableParameter } from 'postgres';

/** Column values for postgres.js's dynamic insert helper, keyed in camelCase. */
export type Values = Record<string, SerializableParameter | null>;

/** The single row a query must return, e.g. from `insert ... returning`. */
export function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(`Expected exactly one row, got ${rows.length}.`);
  }
  return row;
}

/** The row if there is one; throws if the query unexpectedly matched several. */
export function maybeOne<T>(rows: readonly T[]): T | undefined {
  if (rows.length > 1) {
    throw new Error(`Expected at most one row, got ${rows.length}.`);
  }
  return rows[0];
}

/** Drops undefined keys so the insert helper leaves those columns to their defaults. */
export function defined(values: Record<string, SerializableParameter | null | undefined>): Values {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Values;
}
