// A tiny database interface so the same engine code runs on real PostgreSQL
// (postgres.js in production) and on PGlite (in-process Postgres for tests).
// All engine SQL uses $1-style parameters and returns plain rows.

export type Row = Record<string, unknown>;

export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run fn inside one transaction. Nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** Multi-statement SQL without parameters (migrations only). */
  exec(text: string): Promise<void>;
}

export async function one<T = Row>(db: Db, text: string, params?: unknown[]): Promise<T> {
  const rows = await db.query<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
  return rows[0];
}

export async function maybeOne<T = Row>(db: Db, text: string, params?: unknown[]): Promise<T | null> {
  const rows = await db.query<T>(text, params);
  return rows[0] ?? null;
}

/** int8/numeric columns arrive as strings (postgres.js) or bigint (PGlite): normalise. */
export const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
