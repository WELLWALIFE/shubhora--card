import { type Db, maybeOne, n, one } from "../db";
import { fyOf } from "./dates";
import { RuleError } from "./members";
import { settingsFor } from "./settings";

export async function available(db: Db, memberId: number): Promise<number> {
  const b = await one<{ b: unknown }>(db, "select coalesce(sum(amount_paise), 0) as b from ledger where member_id = $1", [memberId]);
  const p = await one<{ p: unknown }>(db,
    "select coalesce(sum(amount_paise), 0) as p from withdrawals where member_id = $1 and status in ('requested', 'approved')", [memberId]);
  return n(b.b) - n(p.p);
}

/** Member asks for a payout. Money leaves the wallet only when the admin marks it paid. */
export async function requestWithdrawal(db: Db, memberId: number, amountPaise: number, date: string) {
  return db.tx(async (t) => {
    const m = await one<{ withdraw_block: boolean; blocked: boolean; status: string }>(t,
      "select withdraw_block, blocked, status from members where id = $1 for update", [memberId]);
    if (m.blocked || m.withdraw_block) throw new RuleError("Withdrawals are on hold for this ID. Contact support.");
    const k = await maybeOne<Record<string, unknown>>(t, "select * from kyc where member_id = $1", [memberId]);
    if (!k || k.status !== "approved") throw new RuleError("Your KYC must be approved before you can withdraw.");
    const { s } = await settingsFor(t, date);
    if (amountPaise < s.minWithdrawalPaise) throw new RuleError(`The minimum withdrawal is ₹${s.minWithdrawalPaise / 100}.`);
    if (amountPaise > (await available(t, memberId))) throw new RuleError("The amount is more than your available balance.");
    const bank = { bank_name: k.bank_name, account_name: k.account_name, account_no: k.account_no, ifsc: k.ifsc };
    const r = await one<{ id: unknown }>(t,
      "insert into withdrawals (member_id, amount_paise, bank_snapshot) values ($1, $2, $3::text::jsonb) returning id",
      [memberId, amountPaise, JSON.stringify(bank)]);
    return n(r.id);
  });
}

export async function decideWithdrawal(db: Db, p: { id: number; adminId: number; action: "approve" | "reject" | "paid"; utr?: string; reason?: string; date: string }) {
  return db.tx(async (t) => {
    const w = await maybeOne<{ member_id: unknown; amount_paise: unknown; status: string }>(t,
      "select member_id, amount_paise, status from withdrawals where id = $1 for update", [p.id]);
    if (!w) throw new RuleError("Withdrawal not found.");
    if (p.action === "reject") {
      if (!["requested", "approved"].includes(w.status)) throw new RuleError("Only a pending request can be rejected.");
      if (!p.reason) throw new RuleError("Give a reason for rejecting.");
      await t.query("update withdrawals set status = 'rejected', reject_reason = $2, decided_at = now(), decided_by = $3 where id = $1",
        [p.id, p.reason, p.adminId]);
    } else if (p.action === "approve") {
      if (w.status !== "requested") throw new RuleError("Only a new request can be approved.");
      await t.query("update withdrawals set status = 'approved', decided_at = now(), decided_by = $2 where id = $1", [p.id, p.adminId]);
    } else {
      if (!["requested", "approved"].includes(w.status)) throw new RuleError("This request is not pending.");
      if (!p.utr?.trim()) throw new RuleError("Enter the bank reference (UTR) of the transfer.");
      await t.query("update withdrawals set status = 'paid', utr = $2, decided_at = now(), decided_by = $3 where id = $1",
        [p.id, p.utr.trim(), p.adminId]);
      await t.query(
        `insert into ledger (member_id, entry, amount_paise, fy, withdrawal_id, note, created_by)
         values ($1, 'withdrawal', $2, $3, $4, $5, $6)`,
        [w.member_id, -n(w.amount_paise), fyOf(p.date), p.id, `Paid to bank, UTR ${p.utr.trim()}`, p.adminId]);
    }
  });
}

/** Manual wallet adjustment. Needs a second admin to approve when made by anyone other than the owner. */
export async function adjustWallet(db: Db, p: { memberId: number; amountPaise: number; note: string; adminId: number; date: string }) {
  if (!p.note?.trim()) throw new RuleError("A manual adjustment needs a note.");
  if (!Number.isInteger(p.amountPaise) || p.amountPaise === 0) throw new RuleError("Enter a non-zero amount.");
  await db.query(
    `insert into ledger (member_id, entry, amount_paise, fy, note, created_by) values ($1, $2, $3, $4, $5, $6)`,
    [p.memberId, p.amountPaise > 0 ? "manual_credit" : "manual_debit", p.amountPaise, fyOf(p.date), p.note.trim(), p.adminId]);
}

/** Weekly auto-withdrawal (owner's call, 24 Sep 2026). Matching still closes every day; after the Sunday closing
 *  (the nightly job early on Monday) every member's whole available balance becomes a withdrawal request, which the
 *  company transfers by hand on Wednesday (Staff Admin → Withdrawals → Paid + UTR).
 *  Only for members whose KYC is approved and whose ID is not blocked or on withdrawal hold; balances below the
 *  minimum withdrawal stay in the wallet for next week. Safe to run twice: the second run finds nothing available. */
export async function weeklyAutoWithdrawals(db: Db, date: string): Promise<{ created: number; totalPaise: number; skippedNoKyc: number }> {
  const { s } = await settingsFor(db, date);
  const rows = await db.query<Record<string, unknown>>(
    `select m.id, k.status as kyc, k.bank_name, k.account_name, k.account_no, k.ifsc,
            (select coalesce(sum(amount_paise), 0) from ledger l where l.member_id = m.id)
          - (select coalesce(sum(amount_paise), 0) from withdrawals w where w.member_id = m.id and w.status in ('requested', 'approved')) as avail
     from members m left join kyc k on k.member_id = m.id
     where not m.blocked and not coalesce(m.withdraw_block, false)`);
  let created = 0, totalPaise = 0, skippedNoKyc = 0;
  for (const r of rows) {
    const avail = n(r.avail);
    if (avail < Math.max(1, s.minWithdrawalPaise)) continue;
    if (r.kyc !== "approved") { skippedNoKyc++; continue; }
    const bank = { bank_name: r.bank_name, account_name: r.account_name, account_no: r.account_no, ifsc: r.ifsc, auto: true, week_ending: date };
    await db.tx(async (t) => {
      // The member's row is locked first, so a request the member makes in the same moment waits and then sees
      // this one: re-reading the balance without the lock let both through.
      await t.query("select id from members where id = $1 for update", [n(r.id)]);
      const again = await available(t, n(r.id));
      if (again < Math.max(1, s.minWithdrawalPaise)) return;
      await t.query("insert into withdrawals (member_id, amount_paise, bank_snapshot) values ($1, $2, $3::text::jsonb)", [n(r.id), again, JSON.stringify(bank)]);
      created++; totalPaise += again;
    });
  }
  return { created, totalPaise, skippedNoKyc };
}
