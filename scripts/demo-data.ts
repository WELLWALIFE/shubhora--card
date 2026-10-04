// Fills the LOCAL development database (.data/pg) with a sample team so every screen has data.
// Never run against production. Usage: npx tsx scripts/demo-data.ts

import { openPglite } from "../src/server/db-lite";
import { migrate } from "../src/server/migrate";
import { DEFAULT_SETTINGS, saveSettings } from "../src/server/engine/settings";
import { createRoot, registerMember, type Leg } from "../src/server/engine/members";
import { recordPayment } from "../src/server/engine/payments";
import { runClosing } from "../src/server/engine/closing";
import { addDays, istDate } from "../src/server/engine/dates";
import { hashPassword } from "../src/server/auth/password";

const NAMES = ["Rahul Sharma", "Priya Verma", "Amit Patel", "Neha Gupta", "Vikas Singh", "Anjali Mehta", "Rohit Jain", "Kavita Rao",
  "Suresh Yadav", "Pooja Nair", "Manoj Tiwari", "Sneha Iyer", "Arjun Reddy", "Meera Joshi", "Deepak Kumar", "Ritu Agarwal",
  "Sanjay Mishra", "Nisha Kapoor", "Karan Malhotra", "Divya Pillai", "Ajay Chauhan", "Swati Desai", "Nitin Bansal", "Asha Menon"];

async function main() {
  if (process.env.DATABASE_URL) throw new Error("Refusing to run with DATABASE_URL set. Demo data is for local development only.");
  // DEMO_DATABASE_URL may point only at a throwaway database whose name contains "smoketest".
  const demoUrl = process.env.DEMO_DATABASE_URL;
  if (demoUrl && !/\/[^/]*smoketest[^/]*$/.test(demoUrl)) throw new Error("DEMO_DATABASE_URL must be a *smoketest* database.");
  const db = demoUrl ? (await import("../src/server/db-pg")).dbFromUrl(demoUrl).db : await openPglite(".data/pg");
  await migrate(db);
  if ((await db.query("select 1 from members limit 1")).length) { console.log("Database already has members; delete .data/pg to start over."); return; }
  await saveSettings(db, "2026-01-01", DEFAULT_SETTINGS, "Initial plan", null);
  await db.query("insert into admins (username, name, password_hash, role) values ('owner', 'Owner', $1, 'owner')", [await hashPassword("owner-dev-password")]);
  const root = await createRoot(db, { name: "Shubhora Company", mobile: "9999999999", password: "company-pass" });

  const today = istDate();
  const start = addDays(today, -6);
  let mobile = 9810000000;
  const ids: { id: number; code: string }[] = [root];
  for (let i = 0; i < NAMES.length; i++) {
    const sponsor = ids[Math.floor(i / 2)];
    const leg: Leg = i % 2 === 0 ? "L" : "R";
    const m = await registerMember(db, { sponsorCode: sponsor.code, leg, name: NAMES[i], mobile: String(mobile++), password: "password123" });
    ids.push({ id: m.id, code: m.code });
    const day = addDays(start, Math.min(5, Math.floor(i / 5)));
    if (i % 6 !== 5) await recordPayment(db, { memberId: m.id, kind: "activation", method: "online", date: day, reference: `demo_${m.code}` });
  }
  // Everyone who is green renews yesterday, so the renewal binary and ranks have data.
  const greens = await db.query<{ id: unknown; code: string }>("select id, code from members where status = 'green' and parent_id is not null");
  for (const g of greens) await recordPayment(db, { memberId: Number(g.id), kind: "renewal", method: "online", date: addDays(today, -1), reference: `demo_ren_${g.code}` });
  for (let d = start; d < today; d = addDays(d, 1)) await runClosing(db, d);
  await db.query("insert into announcements (title, body) values ($1, $2)",
    ["Welcome to Shubhora Partner", "Share your left and right links from Grow. Every paid subscription in your team counts toward your pairs."]);
  console.log(`Demo ready. Member login: ${ids[1].code} / password123 · Admin: owner / owner-dev-password`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
