import { describe, expect, it } from 'vitest';
import { WEB_DB_OPTIONS, createWebDb } from './db';

describe('web database client', () => {
  it('uses one connection, no prepared statements and a short idle timeout', () => {
    expect(WEB_DB_OPTIONS).toEqual({ max: 1, prepare: false, idleTimeout: 20 });
    // The options reach postgres.js (it exposes them on the client).
    const db = createWebDb('postgres://u:p@localhost:5432/x');
    expect(db.options).toMatchObject({ max: 1, prepare: false, idle_timeout: 20 });
  });
});
