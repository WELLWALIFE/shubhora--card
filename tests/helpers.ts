import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db } from "@/server/db";
import { migrate } from "@/server/migrate";
import { createRoot, registerMember, type Leg } from "@/server/engine/members";
import { recordPayment } from "@/server/engine/payments";
import { DEFAULT_SETTINGS, type PlanSettings, saveSettings } from "@/server/engine/settings";

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

let template: Blob | null = null;

/** Migrating a new database for every test is slow, so migrate once and copy the files. */
async function blankDb(): Promise<PGlite> {
  if (!template) {
    const pg = new PGlite();
    await migrate(wrap(pg, pg, false));
    template = await pg.dumpDataDir("none");
    await pg.close();
  }
  return new PGlite({ loadDataDir: template });
}

export async function freshDb(settings: Partial<PlanSettings> = {}) {
  const pg = await blankDb();
  const db = wrap(pg, pg, false);
  await saveSettings(db, "2026-01-01", { ...DEFAULT_SETTINGS, ...settings }, "test defaults", null);
  // A fixed date, not today: every test closes on a date of its own, and a root that only turns green today
  // earns nothing on those dates — which is why the suite went red the morning after it was written.
  const root = await createRoot(db, { name: "Company", mobile: "9000000000", password: "company-pass", greenDate: "2026-01-01" });
  await db.query("insert into admins (id, username, name, password_hash, role) values (1, 'owner', 'Owner', 'x', 'owner')");
  return { db, root };
}

let mobile = 9100000000;

/** Register under a sponsor (extreme placement in that leg) and optionally activate online. */
export async function join(db: Db, sponsorCode: string, leg: Leg, opts: { activate?: string; parentCode?: string; name?: string } = {}) {
  const m = await registerMember(db, {
    sponsorCode, leg, parentCode: opts.parentCode, name: opts.name ?? `Member ${mobile}`,
    mobile: String(mobile++), password: "password123",
  });
  if (opts.activate) {
    await recordPayment(db, { memberId: m.id, kind: "activation", method: "online", date: opts.activate, reference: `pay_${m.code}` });
  }
  return m;
}

export async function balance(db: Db, memberId: number): Promise<number> {
  const r = await db.query<{ b: unknown }>("select coalesce(sum(amount_paise), 0) as b from ledger where member_id = $1", [memberId]);
  return Number(r[0].b);
}

export async function incomeOf(db: Db, memberId: number, kind?: string): Promise<number> {
  const r = await db.query<{ s: unknown }>(
    "select coalesce(sum(gross_paise), 0) as s from incomes where member_id = $1 and ($2::text is null or kind = $2)",
    [memberId, kind ?? null]);
  return Number(r[0].s);
}

export async function state(db: Db, memberId: number, bin: "new" | "renewal") {
  const r = await db.query<Record<string, unknown>>("select * from binary_state where member_id = $1 and bin = $2", [memberId, bin]);
  const x = r[0];
  return x ? { L: Number(x.carry_left), R: Number(x.carry_right), first: !!x.first_pair_done, pairs: Number(x.pairs_total) } : null;
}

export const rs = (rupees: number) => rupees * 100;
