// Removes ALL partner data (members, payments, closings, incomes, wallets, KYC, tickets, logs) and starts fresh
// with only the company's top ID. Keeps: staff logins, company details, plan settings, rank table, show/hide
// switches and the Downloads library. Take a backup first (server/backup.sh pre-deploy) — this cannot be undone.
//
//   CONFIRM_RESET=erase-everything DATABASE_URL=... npx tsx scripts/reset-test-data.ts

import { dbFromUrl } from "../src/server/db-pg";
import { createRoot } from "../src/server/engine/members";

const DATA_TABLES = [
  "reward_instalments", "member_ranks", "suite_sync", "pay_orders", "approvals", "tree_moves", "member_notes", "login_events",
  "password_requests", "ticket_messages", "tickets", "withdrawals", "kyc", "ledger", "incomes", "closing_lines", "binary_state",
  "bv_events", "closings", "payments", "audit_log", "sessions", "login_attempts", "invoice_counters",
  "payment_requests", "link_tokens",
];

async function main() {
  if (process.env.CONFIRM_RESET !== "erase-everything") throw new Error("Set CONFIRM_RESET=erase-everything to reset.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, end } = url.startsWith("pglite:")
    ? { db: await (await import("../src/server/db-lite")).openPglite(url.slice(7)), end: async () => undefined }
    : dbFromUrl(url);
  try {
    const root = (await db.query<{ name: string; mobile: string }>("select name, mobile from members where parent_id is null"))[0];
    // Shubhora app accounts made for these IDs are NOT deleted here (they may be real customers). List them.
    const linked = await db.query<{ code: string; suite_email: string }>("select code, suite_email from members where suite_user_id is not null order by id");
    if (linked.length) {
      console.log(`${linked.length} IDs had a Shubhora app login. Remove test ones in Shubhora admin → Users if needed:`);
      for (const l of linked) console.log(`  ${l.code}  ${l.suite_email}`);
    }
    await db.tx(async (t) => {
      await t.query(`truncate ${DATA_TABLES.join(", ")} restart identity`);
      await t.query("update members set photo_file = null");
      await t.query("delete from files where kind not in ('download', 'company')");
      await t.query("delete from members");
      await t.query("alter sequence members_id_seq restart with 1");
      await t.query("alter sequence member_code_seq restart with 100001");
    });
    await createRoot(db, { name: root?.name ?? "Shubhora", mobile: root?.mobile ?? "9999999999", password: crypto.randomUUID(), codePrefix: process.env.ID_PREFIX || "SH" });
    console.log("Reset done. Only the company ID remains.");
  } finally {
    await end();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
