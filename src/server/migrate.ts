import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db";

const DIR = join(process.cwd(), "src/server/migrations");

/** Apply every migration file not yet recorded, in name order, each in its own transaction.
 *  Migrations are forward-only: never edit a file that has been applied; add a new one. */
export async function migrate(db: Db, dir = DIR): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const text = readFileSync(join(dir, f), "utf8");
    await db.tx(async (t) => {
      await t.exec(text);
      await t.query("insert into schema_migrations (name) values ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}
