import postgres from "postgres";
import type { Db } from "./db";

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql, inTx: boolean): Db {
  return {
    async query(text, params = []) {
      return (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as never;
    },
    async tx(fn) {
      if (inTx) return fn(wrap(sql, true));
      return (sql as postgres.Sql).begin((t) => fn(wrap(t, true))) as never;
    },
    async exec(text) {
      await sql.unsafe(text);
    },
  };
}

let pool: postgres.Sql | null = null;

/** The shared production database handle (DATABASE_URL). */
export function getDb(): Db {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = postgres(url, { max: 10, idle_timeout: 30, connection: { TimeZone: "Asia/Kolkata" } });   // dates in India time
  }
  return wrap(pool, false);
}

export function dbFromUrl(url: string): { db: Db; end: () => Promise<void> } {
  const sql = postgres(url, { max: 4, connection: { TimeZone: "Asia/Kolkata" } });
  return { db: wrap(sql, false), end: () => sql.end() };
}
