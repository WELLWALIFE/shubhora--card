// Fills the database with ~48 TEST partner IDs and two months of history (joinings, activations, renewals,
// a refund, daily closings, incomes, ranks, KYC, withdrawals, tickets) so every screen can be checked.
// Test IDs have no email, so no Shubhora Business Suite account is created for them.
// Remove everything afterwards with scripts/reset-test-data.ts.
//
//   CONFIRM_TEST_DATA=yes DATABASE_URL=... npx tsx scripts/test-data.ts

import { dbFromUrl } from "../src/server/db-pg";
import { migrate } from "../src/server/migrate";
import { addDays, istDate } from "../src/server/engine/dates";
import { registerMember } from "../src/server/engine/members";
import { recordPayment, refundPayment } from "../src/server/engine/payments";
import { runClosing } from "../src/server/engine/closing";
import { decideWithdrawal, requestWithdrawal, available } from "../src/server/engine/wallet";

const NAMES = ["Rahul Sharma", "Priya Verma", "Amit Patel", "Neha Gupta", "Vikas Singh", "Anjali Mehta", "Rohit Jain", "Kavita Rao",
  "Suresh Yadav", "Pooja Nair", "Manoj Tiwari", "Sneha Iyer", "Arjun Reddy", "Meera Joshi", "Deepak Kumar", "Ritu Agarwal",
  "Sanjay Mishra", "Nisha Kapoor", "Karan Malhotra", "Divya Pillai", "Ajay Chauhan", "Swati Desai", "Nitin Bansal", "Asha Menon",
  "Vivek Saxena", "Rekha Bhatt", "Gaurav Sethi", "Shalini Dubey", "Harish Rawat", "Komal Arora", "Pankaj Soni", "Lata Kulkarni",
  "Mohit Goyal", "Payal Shah", "Ravi Shankar", "Jyoti Pandey", "Tarun Bedi", "Sunita Rathore", "Alok Srivastava", "Madhuri Jadhav",
  "Yogesh Thakur", "Preeti Chawla", "Sachin Bhosale", "Rashmi Hegde", "Imran Qureshi", "Farah Khan", "Kunal Mehra", "Tanvi Bose"];

async function main() {
  if (process.env.CONFIRM_TEST_DATA !== "yes") throw new Error("Set CONFIRM_TEST_DATA=yes to add test data.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // "pglite:<dir>" fills the local development database instead (screen testing on a laptop).
  const { db, end } = url.startsWith("pglite:")
    ? { db: await (await import("../src/server/db-lite")).openPglite(url.slice(7)), end: async () => undefined }
    : dbFromUrl(url);
  try {
    await migrate(db);
    const count = Number((await db.query<{ c: unknown }>("select count(*) as c from members"))[0].c);
    if (count > 1) throw new Error(`There are already ${count} members. Run reset-test-data first.`);
    if ((await db.query("select 1 from closings limit 1")).length) throw new Error("Closings already exist. Run reset-test-data first.");
    const root = (await db.query<{ id: unknown; code: string }>("select id, code from members where parent_id is null"))[0];
    const owner = Number((await db.query<{ id: unknown }>("select id from admins where role = 'owner' order by id limit 1"))[0]?.id ?? 0) || null;

    const today = istDate();
    const start = addDays(today, -62);
    const ids: { id: number; code: string; name: string }[] = [{ id: Number(root.id), code: root.code, name: "Company" }];
    type Plan = { i: number; regDay: string; actDay: string | null; comp: boolean };
    const plan: Plan[] = NAMES.map((_, k) => {
      const i = k + 1;
      const regDay = addDays(start, Math.floor(k * 0.7));
      const red = i % 7 === 0;
      return { i, regDay, actDay: red ? null : addDays(regDay, i % 4 === 0 ? 2 : 0), comp: i === 20 };
    });
    // Renewal behaviour per member: early / on time / late / lapse.
    const delayFor = (i: number) => (i % 7 === 3 ? null : i % 4 === 1 ? 4 : i % 5 === 2 ? -2 : 0);
    const refundOf = 13;

    const renewAt = new Map<number, string>(); // member id -> next renewal date
    const memberByIndex = new Map<number, { id: number; code: string }>();
    let mobile = 9000100000;

    for (let day = start; day < today; day = addDays(day, 1)) {
      for (const p of plan.filter((x) => x.regDay === day)) {
        const parent = ids[Math.floor((p.i - 1) / 2)];
        const leg = p.i % 2 === 1 ? "L" : "R";
        const sponsor = p.i % 5 === 0 && p.i > 4 ? ids[Math.floor((Math.floor((p.i - 1) / 2) - 1) / 2)] : parent;
        const m = await registerMember(db, { sponsorCode: sponsor.code, parentCode: parent.code, leg, name: NAMES[p.i - 1], mobile: String(mobile++), password: "test12345" });
        await db.query("update members set created_at = ($2::date + time '10:30') at time zone 'Asia/Kolkata' where id = $1", [m.id, day]);
        ids.push({ id: m.id, code: m.code, name: NAMES[p.i - 1] });
        memberByIndex.set(p.i, m);
      }
      for (const p of plan.filter((x) => x.actDay === day)) {
        const m = memberByIndex.get(p.i)!;
        if (p.comp) await recordPayment(db, { memberId: m.id, kind: "activation", method: "complimentary", date: day, reason: "TEST: staff demo ID", adminId: owner });
        else await recordPayment(db, { memberId: m.id, kind: "activation", method: p.i % 3 === 0 ? "offline" : "online", date: day,
          reference: p.i % 3 === 0 ? `TESTUTR${p.i}` : `test_pay_${m.code}`, reason: p.i % 3 === 0 ? "TEST: bank transfer" : undefined, adminId: p.i % 3 === 0 ? owner : null });
        const until = (await db.query<{ v: string }>("select sub_valid_until::text as v from members where id = $1", [m.id]))[0].v;
        const delay = delayFor(p.i);
        if (delay !== null) renewAt.set(m.id, addDays(addDays(until, 1), delay));
      }
      if (day === addDays(plan[refundOf - 1].actDay ?? start, 3)) {
        const m = memberByIndex.get(refundOf);
        const pay = m && (await db.query<{ id: unknown }>("select id from payments where member_id = $1 and kind = 'activation'", [m.id]))[0];
        if (pay && owner) { await refundPayment(db, { paymentId: Number(pay.id), reason: "TEST: customer asked for refund", adminId: owner, date: day }); renewAt.delete(m!.id); }
      }
      for (const [memberId, when] of [...renewAt]) {
        if (when !== day) continue;
        await recordPayment(db, { memberId, kind: "renewal", method: "online", date: day, reference: `test_ren_${memberId}_${day}` });
        renewAt.delete(memberId);
      }
      await runClosing(db, day, { adminId: owner });
    }

    // KYC: 12 approved, 4 pending, 2 rejected.
    const greens = await db.query<{ id: unknown; code: string; name: string }>(
      "select id, code, name from members where status = 'green' and parent_id is not null order by id limit 18");
    for (const [k, g] of greens.entries()) {
      const status = k < 12 ? "approved" : k < 16 ? "pending" : "rejected";
      const pan = `TESTP${String(1000 + k).padStart(4, "0")}T`;
      await db.query(
        `insert into kyc (member_id, pan, pan_name, bank_name, account_name, account_no, ifsc, status, reject_reason, reviewed_at, reviewed_by, submitted_at)
         values ($1, $2, $3, 'State Bank of India', $3, $4, 'SBIN0001234', $5, $6, case when $5 = 'pending' then null else now() end, $7, now() - interval '5 days')`,
        [g.id, pan, g.name, String(30000000000 + k), status, status === "rejected" ? "Name on PAN and bank account do not match" : null, status === "pending" ? null : owner]);
      if (status === "approved") await db.query("update members set pan = $2 where id = $1", [g.id, pan]);
    }
    // Withdrawals from approved-KYC members who have money: 4 paid, 2 waiting.
    const approved = await db.query<{ member_id: unknown }>("select member_id from kyc where status = 'approved' order by member_id");
    let paid = 0; let waiting = 0;
    for (const a of approved) {
      const bal = await available(db, Number(a.member_id));
      if (bal < 60000) continue;
      const amount = Math.floor(bal / 2 / 10000) * 10000;
      const wid = await requestWithdrawal(db, Number(a.member_id), amount, today);
      if (paid < 4 && owner) { await decideWithdrawal(db, { id: wid, adminId: owner, action: "paid", utr: `TESTUTR${wid}9${Date.now() % 10000}`, date: today }); paid++; }
      else if (waiting < 2) waiting++;
      else break;
    }
    // Support, password help, news, notes.
    const t = ids.slice(3, 6);
    for (const [k, m] of t.entries()) {
      const r = await db.query<{ id: unknown }>("insert into tickets (member_id, subject, status) values ($1, $2, $3) returning id",
        [m.id, ["When will my withdrawal come?", "My renewal pair is not showing", "Please change my bank account"][k], k === 0 ? "answered" : "open"]);
      await db.query("insert into ticket_messages (ticket_id, body) values ($1, $2)", [r[0].id, "TEST: this is a test support message."]);
      if (k === 0 && owner) await db.query("insert into ticket_messages (ticket_id, from_admin, body) values ($1, $2, $3)", [r[0].id, owner, "TEST: it is paid; the UTR is in your wallet."]);
    }
    for (const m of ids.slice(8, 10)) await db.query("insert into password_requests (member_id, login_text, mobile) select id, code, mobile from members where id = $1", [m.id]);
    await db.query("insert into announcements (title, body, created_by) values ($1, $2, $3), ($4, $5, $3)",
      ["TEST: Welcome to Shubhora Partner", "Share your left and right links from Grow. Every paid subscription in your team counts toward your pairs.", owner,
       "TEST: Renewal reminder", "Renew before your subscription ends to keep renewal income and rank credit running."]);
    if (owner) await db.query("insert into member_notes (member_id, admin_id, body, pinned) values ($1, $2, 'TEST: called on phone, will renew on Friday', true)", [ids[4].id, owner]);
    // Test IDs have no email: mark their Shubhora sync as not needed so real sync never touches them.
    await db.query("update suite_sync set status = 'done', done_at = now(), last_error = 'test data: no Shubhora account' where status <> 'done'");

    const s = (await db.query<Record<string, unknown>>(`select (select count(*) from members) as members, (select count(*) from members where status='green') as green,
      (select count(*) from payments) as payments, (select count(*) from closings) as closings, (select coalesce(sum(gross_paise),0) from incomes) as income,
      (select count(*) from member_ranks) as ranks`))[0];
    console.log(`Test data ready: ${s.members} IDs (${s.green} green), ${s.payments} payments, ${s.closings} closings, income ₹${Number(s.income) / 100}, ${s.ranks} ranks. Member password: test12345`);
  } finally {
    await end();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
