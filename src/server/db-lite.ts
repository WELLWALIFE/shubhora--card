import { PGlite, type Transaction } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import type { Db } from "./db";

type Q = PGlite | Transaction;

function wrap(q: Q, pg: PGlite, inTx: boolean): Db {
  return {
    async query(text, params = []) {
      return (await q.query(text, params as unknown[])).rows as never;
    },
    async tx(fn) {
      if (inTx) return fn(wrap(q, pg, true));
      return pg.transaction((t) => fn(wrap(t, pg, true))) as never;
    },
    async exec(text) {
      await q.exec(text);
    },
  };
}

/** Local development database (single process). Not for production. */
export async function openPglite(dir: string): Promise<Db> {
  mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  await pg.exec("set timezone to 'Asia/Kolkata'");
  return wrap(pg, pg, false);
}
