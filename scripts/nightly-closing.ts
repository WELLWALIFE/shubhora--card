// Runs every missing daily closing up to yesterday (IST). Scheduled just after midnight IST.
// On Monday (after Sunday's closing) it also creates the weekly withdrawal requests (see weeklyAutoWithdrawals).
// Usage: DATABASE_URL=... npx tsx scripts/nightly-closing.ts

import { dbFromUrl } from "../src/server/db-pg";
import { addDays, istDate } from "../src/server/engine/dates";
import { runPendingClosings } from "../src/server/engine/closing";
import { removeExpiredReds } from "../src/server/engine/members";
import { settingsFor } from "../src/server/engine/settings";
import { weeklyAutoWithdrawals } from "../src/server/engine/wallet";
import { processSuiteSync } from "../src/server/suite";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, end } = dbFromUrl(url);
  try {
    const today = istDate();
    const first = (await db.query<{ d: string | null }>("select min(event_date)::text as d from bv_events"))[0]?.d;
    if (!first) console.log("No volume yet; nothing to close.");
    else {
      const done = await runPendingClosings(db, addDays(today, -1), first);
      for (const s of done) console.log(`closed ${s.date}: ${s.events} entries, credited ₹${(s.credited / 100).toFixed(2)}`);
      if (!done.length) console.log("Closings already up to date.");
    }
    // Sunday midnight: the closing just done was Sunday's (today is Monday IST) → the week's payouts are requested for
    // everyone with approved KYC; the company transfers them on Wednesday.
    const yesterday = addDays(today, -1);
    if (new Date(`${yesterday}T00:00:00Z`).getUTCDay() === 0) {
      const w = await weeklyAutoWithdrawals(db, yesterday);
      console.log(`weekly payouts (week ending ${yesterday}): ${w.created} requests, ₹${(w.totalPaise / 100).toFixed(2)}; ${w.skippedNoKyc} waiting for KYC`);
    }
    const { s } = await settingsFor(db, today);
    const removed = await removeExpiredReds(db, today, s.redExpiryDays);
    if (removed.length) console.log(`removed ${removed.length} expired red IDs: ${removed.join(", ")}`);
    await db.query("update suite_sync set status = 'pending' where status = 'failed' and attempts < 20");
    const sync = await processSuiteSync(db, 500);
    console.log(`shubhora sync: ${sync.done} done, ${sync.waiting} waiting for email, ${sync.failed} failed`);
  } finally {
    await end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
