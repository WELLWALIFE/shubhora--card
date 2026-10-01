import { type Db, maybeOne, n, one } from "../db";
import { addDays, fyOf, maxDate, monthEnd } from "./dates";
import { bp } from "./matching";
import { RuleError } from "./members";
import { settingsFor } from "./settings";

export type PaymentMethod = "online" | "offline" | "complimentary";

export type PaymentInput = {
  memberId: number;
  kind: "activation" | "renewal";
  method: PaymentMethod;
  date: string;              // business date (IST)
  reference?: string;        // Razorpay payment id, UTR or cheque number
  reason?: string;           // required for offline and complimentary
  adminId?: number | null;
  /** App payments: the amount the customer actually paid (Growth or Pro), GST inside; base/GST are split from it. */
  totalPaise?: number;
  /** App payments: the Shubhora account was already extended by the app itself — never grant the month again. */
  suiteApplied?: boolean;
  /** Admin activations: the BV to put into the binary. Default: the plan's BV for a paid payment, 0 for complimentary. */
  bv?: number;
  /** Admin activations: subscription months covered (1–12). Default 1. */
  months?: number;
  /** Admin activations: false = do NOT give the Shubhora app plan with it (partner ID only). Default true. */
  appPlan?: boolean;
  /** Admin activations: what the admin chose, kept on the payment for reports ("free-0bv", "free-full-bv", …). */
  adminMode?: string;
};

/** Gap-free numbering per series (invoices, credit notes), inside the caller's transaction. */
async function nextNumber(db: Db, series: string, prefix: string): Promise<string> {
  const row = await one<{ last: unknown }>(db,
    `insert into invoice_counters (fy, last) values ($1, 1)
     on conflict (fy) do update set last = invoice_counters.last + 1 returning last`, [series]);
  return `${prefix}/${String(n(row.last)).padStart(6, "0")}`;
}

async function nextInvoiceNo(db: Db, date: string): Promise<string> {
  const fy = fyOf(date);
  return nextNumber(db, fy, `SHB/${fy}`);
}

/** Approve a member's manual payment request: one transaction that CLAIMS the request first, so a second
 *  click (or two admins at once) finds nothing pending and applies nothing. Reading the status and updating it
 *  afterwards let both through — an extra month on the ID and extra BV to the uplines. */
export async function approvePaymentRequest(db: Db, p: { requestId: number; adminId: number; date: string }):
  Promise<{ kind: "activation" | "renewal"; paymentId: number; invoiceNo: string | null; memberId: number }> {
  return db.tx(async (t) => {
    const claim = await t.query<{ member_id: unknown; reference: string; method: string }>(
      `update payment_requests set status = 'approved', decided_by = $2, decided_at = now()
       where id = $1 and status = 'pending' returning member_id, reference, method`, [p.requestId, p.adminId]);
    if (!claim.length) throw new RuleError("This request is no longer pending.");
    const memberId = n(claim[0].member_id);
    const m = await maybeOne<{ status: string }>(t, "select status from members where id = $1", [memberId]);
    const kind: "activation" | "renewal" = m?.status === "green" ? "renewal" : "activation";
    const pay = await recordPayment(t, {
      memberId, kind, method: "offline", date: p.date,
      reference: `${claim[0].method.toUpperCase()}:${claim[0].reference}`,
      reason: `Manual payment request #${p.requestId}`, adminId: p.adminId,
    });
    await t.query("update payment_requests set kind = $2, payment_id = $3 where id = $1", [p.requestId, kind, pay.paymentId]);
    return { kind, paymentId: pay.paymentId, invoiceNo: pay.invoiceNo, memberId };
  });
}

/** Record a subscription payment. Activation turns a Red ID Green; renewal extends the subscription.
 *  Every paid (non-complimentary) payment creates the plan's BV (2,500 from Sep 2026) in the matching binary and a GST invoice.
 *  Idempotent for online payments: the same gateway reference is never applied twice. */
export async function recordPayment(db: Db, p: PaymentInput): Promise<{ paymentId: number; invoiceNo: string | null; duplicate: boolean }> {
  if (p.method === "online" && !p.reference) throw new RuleError("Online payment needs the gateway payment ID.");
  if (p.method === "offline" && !(p.reference && p.reason)) throw new RuleError("Offline payment needs the bank or cash reference and a reason.");
  if (p.method === "complimentary" && !(p.reason && p.adminId)) throw new RuleError("A complimentary activation needs an admin and a written reason.");

  return db.tx(async (t) => {
    if (p.method === "online") {
      const dup = await maybeOne<{ id: unknown; invoice_no: string | null }>(t,
        "select id, invoice_no from payments where method = 'online' and reference = $1", [p.reference]);
      if (dup) return { paymentId: n(dup.id), invoiceNo: dup.invoice_no, duplicate: true };
    }
    const m = await maybeOne<{ status: string; sub_valid_until: string | null; blocked: boolean }>(t,
      "select status, sub_valid_until::text, blocked from members where id = $1 for update", [p.memberId]);
    if (!m) throw new RuleError("Member not found.");
    if (m.blocked) throw new RuleError("This ID is blocked.");
    if (p.kind === "activation" && m.status === "green") throw new RuleError("This ID is already active.");
    if (p.kind === "renewal" && m.status !== "green") throw new RuleError("Only an active (green) ID can renew. Activate it first.");

    const { s } = await settingsFor(t, p.date);
    const total = p.totalPaise && p.totalPaise > 0 ? Math.round(p.totalPaise) : null;
    const base = p.method === "complimentary" ? 0 : total ? Math.round((total * 10000) / (10000 + s.gstBp)) : s.subscriptionBasePaise;
    const gst = total && p.method !== "complimentary" ? total - base : bp(base, s.gstBp);
    const from = p.kind === "renewal" && m.sub_valid_until ? maxDate(addDays(m.sub_valid_until, 1), p.date) : p.date;
    const months = Math.min(12, Math.max(1, Math.round(p.months ?? 1)));
    let to = monthEnd(from);
    for (let i = 1; i < months; i++) to = monthEnd(addDays(to, 1));
    const bvGiven = p.bv !== undefined ? Math.max(0, Math.round(p.bv)) : p.method === "complimentary" ? 0 : s.bvPerSubscription;
    if (bvGiven > 100000) throw new RuleError("BV is too large (at most 1,00,000).");
    const invoiceNo = base > 0 ? await nextInvoiceNo(t, p.date) : null;

    const pay = await one<{ id: unknown }>(t,
      `insert into payments (member_id, kind, method, base_paise, gst_paise, total_paise, reference, reason,
         business_date, period_from, period_to, invoice_no, created_by, admin_mode, bv_given, months, app_plan)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [p.memberId, p.kind, p.method, base, gst, base + gst, p.reference ?? null, p.reason ?? null,
       p.date, from, to, invoiceNo, p.adminId ?? null, p.adminMode ?? null, bvGiven, months, p.appPlan !== false]);
    const paymentId = n(pay.id);

    if (p.kind === "activation") {
      const kind = p.method === "online" ? "paid" : p.method;
      await t.query(
        `update members set status = 'green', green_kind = $2, green_at = now(), green_date = $3, sub_valid_until = $4
         where id = $1`, [p.memberId, kind, p.date, to]);
    } else {
      await t.query("update members set sub_valid_until = greatest(coalesce(sub_valid_until, $2::date), $2::date) where id = $1",
        [p.memberId, to]);
    }

    if (bvGiven > 0) {
      await t.query(
        `insert into bv_events (member_id, bin, bv, payment_id, event_date) values ($1, $2, $3, $4, $5)`,
        [p.memberId, p.kind === "activation" ? "new" : "renewal", bvGiven, paymentId, p.date]);
    }
    // Queue the payment for the Shubhora Business Suite account (processed after commit, retried nightly) —
    // unless the app itself took the payment and has already extended the account.
    if (p.appPlan === false) await t.query("insert into suite_sync (payment_id, member_id, status, done_at, last_error) values ($1, $2, 'done', now(), 'admin: no app plan with this activation') on conflict do nothing", [paymentId, p.memberId]);
    else if (p.suiteApplied) await t.query("insert into suite_sync (payment_id, member_id, status, done_at, last_error) values ($1, $2, 'done', now(), 'paid inside the Shubhora app') on conflict do nothing", [paymentId, p.memberId]);
    else await t.query("insert into suite_sync (payment_id, member_id) values ($1, $2) on conflict do nothing", [paymentId, p.memberId]);
    return { paymentId, invoiceNo, duplicate: false };
  });
}

/** Refund a payment: the BV is removed (voided if not yet closed, otherwise reversed as negative BV
 *  at the next closing), the Direct Sale Bonus paid on it is clawed back from the sponsor's wallet,
 *  and the subscription period is withdrawn. An activation refund turns the ID Red again. */
export async function refundPayment(db: Db, p: { paymentId: number; reason: string; adminId: number; date: string }) {
  if (!p.reason?.trim()) throw new RuleError("A refund needs a reason.");
  return db.tx(async (t) => {
    const pay = await maybeOne<{ member_id: unknown; kind: string; status: string; period_from: string }>(t,
      "select member_id, kind, status, period_from::text from payments where id = $1 for update", [p.paymentId]);
    if (!pay) throw new RuleError("Payment not found.");
    if (pay.status !== "paid") throw new RuleError("This payment is already refunded.");
    const memberId = n(pay.member_id);

    const inv = await maybeOne<{ invoice_no: string | null }>(t, "select invoice_no from payments where id = $1", [p.paymentId]);
    const creditNote = inv?.invoice_no ? await nextNumber(t, `CN-${fyOf(p.date)}`, `SHB-CN/${fyOf(p.date)}`) : null;
    await t.query("update payments set status = 'refunded', refunded_at = now(), refund_reason = $2, credit_note_no = $3 where id = $1",
      [p.paymentId, p.reason, creditNote]);

    const ev = await maybeOne<{ id: unknown; bin: string; bv: unknown; closing_id: unknown }>(t,
      "select id, bin, bv, closing_id from bv_events where payment_id = $1 and not void and reverses_id is null", [p.paymentId]);
    if (ev) {
      if (ev.closing_id === null) {
        await t.query("update bv_events set void = true where id = $1", [ev.id]);
      } else {
        await t.query(
          `insert into bv_events (member_id, bin, bv, payment_id, reverses_id, event_date) values ($1,$2,$3,$4,$5,$6)`,
          [memberId, ev.bin, -n(ev.bv), p.paymentId, ev.id, p.date]);
        const direct = await t.query<{ id: unknown; member_id: unknown; gross_paise: unknown; held: boolean }>(
          "select id, member_id, gross_paise, held from incomes where bv_event_id = $1 and kind = 'direct'", [ev.id]);
        for (const inc of direct) {
          if (inc.held) {
            await t.query("update incomes set gross_paise = 0, note = 'Cancelled: payment refunded' where id = $1", [inc.id]);
          } else {
            await t.query(
              `insert into ledger (member_id, entry, amount_paise, fy, income_id, note, created_by)
               values ($1, 'clawback', $2, $3, $4, $5, $6)`,
              [inc.member_id, -n(inc.gross_paise), fyOf(p.date), inc.id, `Refund of payment #${p.paymentId}`, p.adminId]);
          }
        }
      }
    }

    const until = addDays(pay.period_from, -1);
    if (pay.kind === "activation") {
      await t.query(
        "update members set status = 'red', green_kind = null, green_at = null, green_date = null, sub_valid_until = null where id = $1",
        [memberId]);
    } else {
      await t.query("update members set sub_valid_until = $2 where id = $1", [memberId, until]);
    }
  });
}
