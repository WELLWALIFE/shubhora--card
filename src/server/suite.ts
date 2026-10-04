// Link to the Shubhora Business Suite (the product the subscription pays for).
// The Suite exposes one signed server-to-server endpoint; this file is the only caller.
//   ensure → create the member's Suite account (an existing account with that email is never taken over)
//   grant  → apply one paid month to that account (idempotent per payment)
//   login  → one-time sign-in token so the member opens the Suite without a password
//   password → keep the Suite password equal to the partner password (one login for both)
//   revoke → take back the month a refunded payment gave
//   credits → add AI credits (the Direct Sale Bonus is paid this way; idempotent per ref)
//   joined  → welcome email to a new partner and a new-registration alert to the company (sent by the Suite's mailer)

import { createHmac, randomUUID } from "node:crypto";
import type { Db } from "./db";
import { maybeOne, n } from "./db";

const URL_ = () => process.env.SUITE_LINK_URL ?? "";
const SECRET = () => process.env.SUITE_LINK_SECRET ?? "";
export const suiteReady = () => !!(URL_() && SECRET());
export const suiteOrigin = () => { try { return new URL(process.env.SUITE_PUBLIC_URL || URL_()).origin; } catch { return ""; } };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const raw = JSON.stringify({ ...body, ts: Date.now() });
  const sig = createHmac("sha256", SECRET()).update(raw).digest("hex");
  const res = await fetch(URL_(), { method: "POST", headers: { "content-type": "application/json", "x-link-signature": sig }, body: raw, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Suite answered ${res.status}`);
  return j;
}

type M = { id: unknown; code: string; name: string; mobile: string; email: string | null; suite_user_id: string | null };

/** Make sure the member has a Suite account; returns its id, or null when the member has no email yet. */
export async function ensureSuiteUser(db: Db, memberId: number, opts: { password?: string; basic?: boolean } = {}): Promise<string | null> {
  const m = await maybeOne<M>(db, "select id, code, name, mobile, email, suite_user_id from members where id = $1", [memberId]);
  if (!m) throw new Error("member not found");
  if (m.suite_user_id) return m.suite_user_id;
  if (!m.email) return null;
  // The SH code is the identity. An ID is tied to an app account only when that account is made for it right now —
  // never to an account that already exists with the same email (that may be another ID's person, and mixing them
  // is exactly what this prevents). An existing account is linked by hand in Super Admin → Users.
  const email = m.email.trim().toLowerCase();
  const twin = await maybeOne<{ code: string }>(db, "select code from members where lower(email) = $1 and id <> $2 and suite_user_id is not null limit 1", [email, memberId]);
  if (twin) throw new Error(`${email} is already the app login of ${twin.code} — give ${m.code} its own email, or link its app account in Super Admin`);
  const r = await call<{ userId: string; created?: boolean }>({ action: "ensure", email, name: m.name, mobile: m.mobile, code: m.code, basic: true, ...opts });
  if (!r.created) throw new Error(`An app account with ${email} already exists — ${m.code} is not linked to it automatically. Link it in Super Admin → Users, or change this ID's email`);
  const other = await maybeOne<{ code: string }>(db, "select code from members where suite_user_id = $1 and id <> $2", [r.userId, memberId]);
  if (other) throw new Error(`That app account belongs to ${other.code} — ${m.code} was not linked`);
  await db.query("update members set suite_user_id = $2, suite_email = $3 where id = $1 and suite_user_id is null", [memberId, r.userId, email]);
  return r.userId;
}

/** Push queued payments to the Suite. Safe to run any time; each payment is applied once. */
export async function processSuiteSync(db: Db, limit = 50): Promise<{ done: number; waiting: number; failed: number }> {
  if (!suiteReady()) return { done: 0, waiting: 0, failed: 0 };
  const rows = await db.query<Record<string, unknown>>(
    `select s.payment_id, s.member_id, p.method, p.total_paise, p.kind, p.status as pay_status, coalesce(p.months, 1) as months
     from suite_sync s join payments p on p.id = s.payment_id
     where s.status <> 'done' and s.attempts < 20 order by s.created_at limit $1`, [limit]);
  let done = 0; let waiting = 0; let failed = 0;
  for (const r of rows) {
    const paymentId = n(r.payment_id); const memberId = n(r.member_id);
    try {
      if (r.pay_status !== "paid") {
        await db.query("update suite_sync set status = 'done', done_at = now(), last_error = 'payment refunded before sync' where payment_id = $1", [paymentId]);
        continue;
      }
      const userId = await ensureSuiteUser(db, memberId);
      if (!userId) {
        await db.query("update suite_sync set last_error = 'waiting for the member to add an email' where payment_id = $1", [paymentId]);
        waiting++;
        continue;
      }
      // One app month per payment month (an admin can activate several months at once); each ref is applied once.
      const months = Math.min(12, Math.max(1, n(r.months)));
      for (let k = 1; k <= months; k++) {
        await call({ action: "grant", userId, ref: k === 1 ? `partner-${paymentId}` : `partner-${paymentId}-m${k}`, amountPaise: Math.max(1, Math.round(n(r.total_paise) / months)), method: r.method });
      }
      await db.query("update suite_sync set status = 'done', done_at = now(), last_error = null, attempts = attempts + 1 where payment_id = $1", [paymentId]);
      done++;
    } catch (e) {
      await db.query("update suite_sync set status = 'failed', attempts = attempts + 1, last_error = $2 where payment_id = $1",
        [paymentId, (e as Error).message.slice(0, 300)]);
      failed++;
    }
  }
  const c = await processCreditSync(db, limit);
  return { done: done + c.done, waiting: waiting + c.waiting, failed: failed + c.failed };
}

/** Push queued bonus credits (Direct Sale Bonus as AI credits) to the sponsor's Suite account. */
async function processCreditSync(db: Db, limit: number): Promise<{ done: number; waiting: number; failed: number }> {
  const rows = await db.query<Record<string, unknown>>(
    "select ref, member_id, credits from suite_credit_sync where status <> 'done' and attempts < 20 order by created_at limit $1", [limit]);
  let done = 0; let waiting = 0; let failed = 0;
  for (const r of rows) {
    const ref = String(r.ref);
    try {
      const userId = await ensureSuiteUser(db, n(r.member_id));
      if (!userId) {
        await db.query("update suite_credit_sync set last_error = 'waiting for the member to add an email' where ref = $1", [ref]);
        waiting++;
        continue;
      }
      await call({ action: "credits", userId, ref: `partner-${ref}`, credits: n(r.credits), reason: "Direct Sale Bonus" });
      await db.query("update suite_credit_sync set status = 'done', done_at = now(), last_error = null, attempts = attempts + 1 where ref = $1", [ref]);
      done++;
    } catch (e) {
      await db.query("update suite_credit_sync set status = 'failed', attempts = attempts + 1, last_error = $2 where ref = $1", [ref, (e as Error).message.slice(0, 300)]);
      failed++;
    }
  }
  return { done, waiting, failed };
}

/** One-time sign-in address for the member's Suite account. */
export async function suiteLoginUrl(db: Db, memberId: number): Promise<string | null> {
  const userId = await ensureSuiteUser(db, memberId);
  if (!userId) return null;
  const r = await call<{ url: string }>({ action: "login", userId });
  return r.url;
}

/** New ID: create the Suite login right away with the same password, on the basic card until paid.
 *  Never blocks registration; a failure is retried later by the normal sync. */
export async function linkNewMember(db: Db, memberId: number, password: string): Promise<void> {
  if (!suiteReady()) return;
  await ensureSuiteUser(db, memberId, { password, basic: true }).catch(() => undefined);
}

/** New ID: welcome email to the partner and an alert to the company. Never blocks registration. */
export async function announceNewMember(db: Db, memberId: number): Promise<void> {
  if (!suiteReady()) return;
  const m = await maybeOne<{ code: string; name: string; mobile: string; email: string | null; sponsor: string | null }>(db,
    "select m.code, m.name, m.mobile, m.email, s.code as sponsor from members m left join members s on s.id = m.sponsor_id where m.id = $1", [memberId]);
  if (!m) return;
  await call({ action: "joined", code: m.code, name: m.name, mobile: m.mobile, email: m.email ?? "", sponsor: m.sponsor ?? "" }).catch(() => undefined);
}

/** Keep the Suite password the same as the partner password. Silent when not linked. */
export async function syncSuitePassword(db: Db, memberId: number, password: string): Promise<void> {
  if (!suiteReady()) return;
  const m = await maybeOne<{ suite_user_id: string | null }>(db, "select suite_user_id from members where id = $1", [memberId]);
  if (!m?.suite_user_id) return;
  await call({ action: "password", userId: m.suite_user_id, password }).catch(() => undefined);
}

/** A refunded payment takes back the Suite month it gave (only if it had been applied). */
export async function revokeSuitePayment(db: Db, paymentId: number): Promise<void> {
  if (!suiteReady()) return;
  const r = await maybeOne<{ suite_user_id: string | null; status: string | null; months: unknown; app_plan: boolean | null }>(db,
    "select m.suite_user_id, s.status, coalesce(p.months, 1) as months, p.app_plan from payments p join members m on m.id = p.member_id left join suite_sync s on s.payment_id = p.id where p.id = $1", [paymentId]);
  if (!r?.suite_user_id || r.status !== "done" || r.app_plan === false) return;
  const months = Math.min(12, Math.max(1, n(r.months)));
  for (let k = 1; k <= months; k++) await call({ action: "revoke", userId: r.suite_user_id, ref: k === 1 ? `partner-${paymentId}` : `partner-${paymentId}-m${k}` });
}

/** Short-lived signed pass for the owner to open the Shubhora admin (same format the Suite verifies). */
export function suiteAdminHandoff(sub: string): string {
  const body = Buffer.from(JSON.stringify({ sub, typ: "handoff", exp: Math.floor(Date.now() / 1000) + 60, n: randomUUID() })).toString("base64url");
  const mac = createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `v1.${body}.${mac}`;
}
