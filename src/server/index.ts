import "server-only";
import type { Db } from "./db";
import { maybeOne } from "./db";
import { migrate } from "./migrate";
import { DEFAULT_SETTINGS, saveSettings } from "./engine/settings";
import { createRoot } from "./engine/members";
import { hashPassword } from "./auth/password";

// One database handle per server process. Production uses PostgreSQL (DATABASE_URL);
// local development without DATABASE_URL uses an on-disk PGlite database in ./.data.

const g = globalThis as unknown as { __partnerDb?: Promise<Db> };

async function open(): Promise<Db> {
  let db: Db;
  if (process.env.DATABASE_URL) {
    const { getDb } = await import("./db-pg");
    db = getDb();
  } else {
    const { openPglite } = await import("./db-lite");
    db = await openPglite(".data/pg");
  }
  await migrate(db);
  await seed(db);
  return db;
}

/** First run only: plan settings, the company's top ID and the owner admin login. */
async function seed(db: Db) {
  if (!(await maybeOne(db, "select 1 from plan_settings limit 1")))
    await saveSettings(db, "2026-01-01", DEFAULT_SETTINGS, "Initial plan", null);
  if (!(await maybeOne(db, "select 1 from members limit 1")))
    await createRoot(db, {
      name: process.env.COMPANY_NAME || "Shubhora",
      mobile: process.env.COMPANY_MOBILE || "9999999999",
      password: process.env.ROOT_PASSWORD || cryptoRandom(),
      codePrefix: process.env.ID_PREFIX || "SH",
    });
  // The owner login is created either from OWNER_PASSWORD (local) or through /admin/setup with SETUP_TOKEN (production).
  if (!process.env.SETUP_TOKEN && !(await maybeOne(db, "select 1 from admins limit 1"))) {
    if (process.env.NODE_ENV === "production" && !process.env.OWNER_PASSWORD) throw new Error("Set SETUP_TOKEN or OWNER_PASSWORD for the first owner login");
    await db.query("insert into admins (username, name, password_hash, role) values ($1, $2, $3, 'owner')",
      [process.env.OWNER_USERNAME || "owner", "Owner", await hashPassword(process.env.OWNER_PASSWORD || "owner-dev-password")]);
  }
}

function cryptoRandom() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
}

export function db(): Promise<Db> {
  if (!g.__partnerDb) g.__partnerDb = open().catch((e) => { g.__partnerDb = undefined; throw e; });
  return g.__partnerDb;
}
