"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { newSecret, verifyTotp } from "@/server/auth/totp";
import { requireAdmin, startSession, type Perm } from "@/server/auth/session";
import { runClosing } from "@/server/engine/closing";
import { istDate } from "@/server/engine/dates";
import { memberByCode, memberByHandle, RuleError, registerMember } from "@/server/engine/members";
import { approvePaymentRequest, recordPayment, refundPayment } from "@/server/engine/payments";
import { PlanSettings, saveSettings, settingsFor } from "@/server/engine/settings";
import { adjustWallet, decideWithdrawal } from "@/server/engine/wallet";
import { audit } from "@/server/queries";
import { announceNewMember, processSuiteSync, revokeSuitePayment, syncSuitePassword } from "@/server/suite";
import type { FormState } from "./auth";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const id = (f: FormData, k = "member") => Number(f.get(k) ?? 0);

/** Every admin mutation goes through here: permission check, rule errors shown to the user, audit entry. */
async function act(perm: Perm, fn: (adminId: number) => Promise<string | void>, paths: string[] = []): Promise<FormState> {
  const a = await requireAdmin(perm);
  try {
    const ok = await fn(a.id);
    for (const p of paths) revalidatePath(p);
    return { ok: ok || "Saved." };
  } catch (e) {
    if (e instanceof RuleError) return { error: e.message };
    throw e;
  }
}

function needReason(r: string) { if (r.length < 4) throw new RuleError("Write a reason (it is saved in the activity log)."); }

export async function makeGreenAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const memberId = id(f); const kind = s(f, "kind"); const reason = s(f, "reason");
    needReason(reason);
    if (kind !== "offline" && kind !== "complimentary") throw new RuleError("Choose paid offline or complimentary.");
    const r = await recordPayment(await db(), { memberId, kind: "activation", method: kind, date: istDate(), reference: s(f, "reference") || undefined, reason, adminId });
    await audit(adminId, memberId, `activate.${kind}`, reason, { paymentId: r.paymentId, invoice: r.invoiceNo, reference: s(f, "reference") });
    await processSuiteSync(await db(), 10).catch(() => undefined);
    return kind === "offline" ? `ID is green. Invoice ${r.invoiceNo}.` : "ID is green (complimentary, no BV).";
  }, ["/admin/members"]);
}

/** Admin activation with any terms (owner's call, 24 Sep 2026) — one form for every case:
 *  a leader's free entry (0 BV), a free entry that still carries full BV, a paid entry (cash / UPI / bank),
 *  a part payment with part BV, several months at once, with or without the Shubhora app plan. One or many IDs
 *  (username or SH code, one per line). Every activation is a payments row + an activity-log entry (the record). */
export async function adminActivateAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const handles = s(f, "handles").split(/[\s,;]+/).map((h) => h.trim()).filter(Boolean);
    if (!handles.length) throw new RuleError("Write at least one username or SH code.");
    if (handles.length > 200) throw new RuleError("At most 200 IDs at a time.");
    const reason = s(f, "reason"); needReason(reason);
    const mode = s(f, "mode") || "custom";
    const want = s(f, "kind");                                   // auto | activation | renewal
    const rupees = Number(s(f, "amount") || 0);
    if (!Number.isFinite(rupees) || rupees < 0 || rupees > 1_000_000) throw new RuleError("Amount must be 0 or more (in rupees).");
    const totalPaise = Math.round(rupees * 100);
    const reference = s(f, "reference");
    if (totalPaise > 0 && reference.length < 3) throw new RuleError("Money received: write the UTR / cash receipt / cheque number.");
    const d = await db();
    const { s: plan } = await settingsFor(d, istDate());
    const bvMode = s(f, "bvMode");                               // none | full | custom
    const bv = bvMode === "none" ? 0 : bvMode === "full" ? plan.bvPerSubscription : Math.round(Number(s(f, "bv") || 0));
    if (!Number.isFinite(bv) || bv < 0) throw new RuleError("BV must be 0 or more.");
    const months = Math.min(12, Math.max(1, Math.round(Number(s(f, "months") || 1))));
    const appPlan = s(f, "appPlan") !== "0";

    const done: string[] = []; const failed: string[] = [];
    for (const h of handles) {
      try {
        const m = await memberByHandle(d, h);
        if (!m) throw new RuleError("not found");
        const kind = want === "activation" || want === "renewal" ? want : m.status === "green" ? "renewal" : "activation";
        const memberId = n(m.id);
        const r = await recordPayment(d, {
          memberId, kind, method: totalPaise > 0 ? "offline" : "complimentary", date: istDate(),
          reference: reference || undefined, reason: `${reason} [admin: ${mode}]`, adminId,
          totalPaise: totalPaise > 0 ? totalPaise : undefined, bv, months, appPlan, adminMode: mode,
        });
        await audit(adminId, memberId, `${kind === "activation" ? "activate" : "renew"}.admin`, reason,
          { mode, amountPaise: totalPaise, bv, months, appPlan, paymentId: r.paymentId, invoice: r.invoiceNo, reference });
        done.push(`${m.username || m.code}${kind === "renewal" ? " (renewed)" : ""}`);
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        failed.push(`${h}: ${e.message}`);
      }
    }
    await processSuiteSync(d, 50).catch(() => undefined);
    const bvTxt = bv > 0 ? `${bv.toLocaleString("en-IN")} BV` : "0 BV";
    const summary = `${done.length} done (${bvTxt}, ${months} month${months > 1 ? "s" : ""}${totalPaise ? `, ₹${rupees.toLocaleString("en-IN")} each` : ", free"}${appPlan ? ", app plan given" : ", no app plan"})${done.length ? `: ${done.join(", ")}` : ""}.`;
    if (failed.length && !done.length) throw new RuleError(`Nothing was activated. ${failed.join(" · ")}`);
    return failed.length ? `${summary} Not done — ${failed.join(" · ")}` : summary;
  }, ["/admin/members", "/admin/activate", "/admin/payments"]);
}

export async function renewOfflineAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const memberId = id(f); const reason = s(f, "reason"); needReason(reason);
    const r = await recordPayment(await db(), { memberId, kind: "renewal", method: "offline", date: istDate(), reference: s(f, "reference"), reason, adminId });
    await audit(adminId, memberId, "renew.offline", reason, { paymentId: r.paymentId, invoice: r.invoiceNo });
    await processSuiteSync(await db(), 10).catch(() => undefined);
    return `Renewed. Invoice ${r.invoiceNo}.`;
  }, ["/admin/members"]);
}

const TOGGLES = { blocked: "Block ID", income_hold: "Hold income", withdraw_block: "Block withdrawals", show_balance: "Show wallet balance" } as const;

export async function toggleAction(_: FormState, f: FormData): Promise<FormState> {
  return act("members", async (adminId) => {
    const memberId = id(f); const field = s(f, "field") as keyof typeof TOGGLES; const reason = s(f, "reason");
    if (!(field in TOGGLES)) throw new RuleError("Unknown setting.");
    needReason(reason);
    const value = f.get("value") === "1";
    await (await db()).query(`update members set ${field} = $2 where id = $1`, [memberId, value]);
    if (field === "blocked" && value) await (await db()).query("delete from sessions where kind = 'member' and subject_id = $1", [memberId]);
    await audit(adminId, memberId, `member.${field}`, reason, { value });
    return `${TOGGLES[field]}: ${value ? "on" : "off"}.`;
  }, ["/admin/members"]);
}

export async function editMemberAction(_: FormState, f: FormData): Promise<FormState> {
  return act("members", async (adminId) => {
    const memberId = id(f); const reason = s(f, "reason"); needReason(reason);
    const mobile = s(f, "mobile").replace(/\D/g, "").slice(-10);
    if (mobile.length !== 10) throw new RuleError("Enter a valid 10-digit mobile number.");
    const d = await db();
    const before = await maybeOne(d, "select name, mobile, email from members where id = $1", [memberId]);
    // One mobile / one email ↔ one ID, so two IDs can never be matched to each other through them.
    const dupM = await maybeOne<{ code: string }>(d, "select code from members where mobile = $1 and id <> $2", [mobile, memberId]);
    if (dupM) throw new RuleError(`That mobile number is used by another ID (${dupM.code}).`);
    const email = s(f, "email").trim().toLowerCase();
    const dupE = email ? await maybeOne<{ code: string }>(d, "select code from members where lower(email) = $1 and id <> $2 limit 1", [email, memberId]) : null;
    if (dupE) throw new RuleError(`That email is used by another ID (${dupE.code}). One email, one ID.`);
    try {
      await d.query("update members set name = $2, mobile = $3, email = nullif($4, '') where id = $1", [memberId, s(f, "name"), mobile, email]);
    } catch { throw new RuleError("That mobile number is used by another ID."); }
    await audit(adminId, memberId, "member.edit", reason, { before, after: { name: s(f, "name"), mobile, email } });
  }, ["/admin/members"]);
}

export async function resetPasswordAction(_: FormState, f: FormData): Promise<FormState> {
  return act("members", async (adminId) => {
    const memberId = id(f); const pw = s(f, "password");
    if (pw.length < 8) throw new RuleError("The new password must be at least 8 characters.");
    const d = await db();
    await d.query("update members set password_hash = $2 where id = $1", [memberId, await hashPassword(pw)]);
    await d.query("delete from sessions where kind = 'member' and subject_id = $1", [memberId]);
    await syncSuitePassword(d, memberId, pw);
    await audit(adminId, memberId, "member.reset_password", s(f, "reason") || null);
    return "Password changed. Share it with the member privately.";
  });
}

export async function loginAsAction(f: FormData) {
  const a = await requireAdmin("members");
  const memberId = id(f);
  await audit(a.id, memberId, "member.login_as", null);
  await startSession("member", memberId, a.id);
  redirect("/dashboard");
}

export async function adjustWalletAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const memberId = id(f); const rupees = Number(s(f, "amount")); const note = s(f, "note");
    const sign = s(f, "direction") === "debit" ? -1 : 1;
    if (!Number.isFinite(rupees) || rupees <= 0) throw new RuleError("Enter an amount in rupees.");
    if (!note) throw new RuleError("A manual adjustment needs a note.");
    const amountPaise = sign * Math.round(rupees * 100);
    const d = await db();
    const role = (await maybeOne<{ role: string }>(d, "select role from admins where id = $1", [adminId]))?.role;
    if (role !== "owner") {
      await d.query("insert into approvals (kind, member_id, payload, reason, requested_by) values ('wallet_adjust', $1, $2::text::jsonb, $3, $4)",
        [memberId, JSON.stringify({ amountPaise }), note, adminId]);
      await audit(adminId, memberId, "wallet.adjust_requested", note, { rupees: sign * rupees });
      return "Sent to the owner for approval. The wallet changes after approval.";
    }
    await adjustWallet(d, { memberId, amountPaise, note, adminId, date: istDate() });
    await audit(adminId, memberId, `wallet.${sign > 0 ? "credit" : "debit"}`, note, { rupees });
    return "Wallet updated.";
  }, ["/admin/members"]);
}

export async function refundAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const paymentId = id(f, "payment"); const reason = s(f, "reason"); needReason(reason);
    const p = await maybeOne<{ member_id: unknown }>(await db(), "select member_id from payments where id = $1", [paymentId]);
    await refundPayment(await db(), { paymentId, reason, adminId, date: istDate() });
    await audit(adminId, p ? n(p.member_id) : null, "payment.refund", reason, { paymentId });
    try { await revokeSuitePayment(await db(), paymentId); } catch {
      return "Refunded. BV and income on it are reversed. The Shubhora app month could not be taken back automatically; reduce it in Shubhora admin.";
    }
    return "Refunded. BV and income on it are reversed, and the Shubhora app month is taken back.";
  }, ["/admin/payments", "/admin/members"]);
}

export async function adminRegisterAction(_: FormState, f: FormData): Promise<FormState> {
  return act("members", async (adminId) => {
    const m = await registerMember(await db(), {
      sponsorCode: s(f, "sponsor"), leg: s(f, "leg") === "R" ? "R" : "L", parentCode: s(f, "parent") || undefined,
      name: s(f, "name"), mobile: s(f, "mobile"), email: s(f, "email"), password: s(f, "password"),
      codePrefix: process.env.ID_PREFIX || "SH",
    });
    await audit(adminId, m.id, "member.register_by_admin", null, { sponsor: s(f, "sponsor"), parent: s(f, "parent"), leg: s(f, "leg") });
    await announceNewMember(await db(), m.id);
    return `Created ${m.code} (red).`;
  }, ["/admin/members"]);
}

export async function closingAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const date = s(f, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RuleError("Choose a date.");
    if (date >= istDate()) throw new RuleError("A day can be closed only after it has ended.");
    const r = await runClosing(await db(), date, { adminId });
    await audit(adminId, null, "closing.post", null, r.summary);
    return `Closing for ${date} posted.`;
  }, ["/admin/closing", "/admin"]);
}

export async function withdrawalAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const wid = id(f, "withdrawal"); const action = s(f, "action") as "approve" | "reject" | "paid";
    await decideWithdrawal(await db(), { id: wid, adminId, action, utr: s(f, "utr"), reason: s(f, "reason"), date: istDate() });
    const w = await maybeOne<{ member_id: unknown }>(await db(), "select member_id from withdrawals where id = $1", [wid]);
    await audit(adminId, w ? n(w.member_id) : null, `withdrawal.${action}`, s(f, "reason") || null, { withdrawal: wid, utr: s(f, "utr") });
  }, ["/admin/withdrawals"]);
}

export async function kycDecisionAction(_: FormState, f: FormData): Promise<FormState> {
  return act("kyc", async (adminId) => {
    const memberId = id(f); const approve = s(f, "decision") === "approve"; const reason = s(f, "reason");
    if (!approve) needReason(reason);
    const d = await db();
    await d.tx(async (t) => {
      const k = await maybeOne<{ pan: string }>(t, "select pan from kyc where member_id = $1", [memberId]);
      if (!k) throw new RuleError("No KYC submitted.");
      if (approve) {
        const dup = await t.query("select 1 from members where upper(pan) = upper($1) and id <> $2", [k.pan, memberId]);
        if (dup.length) throw new RuleError("This PAN is already on another ID. One person, one ID.");
        await t.query("update members set pan = $2 where id = $1", [memberId, k.pan]);
      }
      await t.query("update kyc set status = $2, reject_reason = $3, reviewed_at = now(), reviewed_by = $4 where member_id = $1",
        [memberId, approve ? "approved" : "rejected", approve ? null : reason, adminId]);
    });
    await audit(adminId, memberId, approve ? "kyc.approve" : "kyc.reject", reason || null);
  }, ["/admin/kyc"]);
}

export async function flagAction(f: FormData) {
  const a = await requireAdmin("plan");
  const key = s(f, "key"); const enabled = f.get("enabled") === "1";
  await (await db()).query("update flags set enabled = $2, updated_at = now(), updated_by = $3 where key = $1", [key, enabled, a.id]);
  await audit(a.id, null, "flag.set", null, { key, enabled });
  revalidatePath("/admin/controls");
}

export async function planAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const from = s(f, "effective_from"); const note = s(f, "note"); needReason(note);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new RuleError("Choose the date the change starts.");
    const d = await db();
    const last = await maybeOne<{ d: string | null }>(d, "select max(closing_date)::text as d from closings");
    if (last?.d && from <= last.d) throw new RuleError(`Closings up to ${last.d} are already posted. Choose a later start date.`);
    const cur = (await settingsFor(d, from)).s;
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(cur)) {
      const raw = f.get(k);
      if (raw === null) continue;
      next[k] = typeof v === "boolean" ? raw === "1" : Math.round(Number(raw) * (MULT[k] ?? 1));
    }
    const parsed = PlanSettings.safeParse(next);
    if (!parsed.success) throw new RuleError("One of the values is not valid. Check the numbers.");
    await saveSettings(d, from, parsed.data, note, adminId);
    await audit(adminId, null, "plan.change", note, { effectiveFrom: from, values: parsed.data });
    return `Plan saved. It applies from ${from}.`;
  }, ["/admin/plan"]);
}

/** Form fields are entered in rupees and percent; stored in paise and basis points. */
const MULT: Record<string, number> = {
  bvValuePaise: 100, pairIncomePaise: 100, dailyCapPaise: 100, binaryCeilingPaise: 100, tdsThresholdPaise: 100, subscriptionBasePaise: 100, minWithdrawalPaise: 100,
  directBonusBp: 100, sponsorBonusBp: 100, tdsWithPanBp: 100, tdsWithoutPanBp: 100, adminChargeBp: 100, gstBp: 100,
};

export async function ticketReplyAction(_: FormState, f: FormData): Promise<FormState> {
  return act("support", async (adminId) => {
    const t = id(f, "ticket"); const body = s(f, "body"); const close = f.get("close") === "1";
    const d = await db();
    if (body) await d.query("insert into ticket_messages (ticket_id, from_admin, body) values ($1, $2, $3)", [t, adminId, body]);
    await d.query("update tickets set status = $2, updated_at = now() where id = $1", [t, close ? "closed" : "answered"]);
    return close ? "Ticket closed." : "Reply sent.";
  }, ["/admin/support"]);
}

export async function newsAction(_: FormState, f: FormData): Promise<FormState> {
  return act("support", async (adminId) => {
    const title = s(f, "title"); const body = s(f, "body");
    if (!title || !body) throw new RuleError("Add a title and the message.");
    await (await db()).query("insert into announcements (title, body, publish_at, created_by) values ($1, $2, coalesce(nullif($3, '')::timestamptz, now()), $4)",
      [title, body, s(f, "publish_at"), adminId]);
    await audit(adminId, null, "news.create", null, { title });
    return "Announcement published.";
  }, ["/admin/news"]);
}

export async function newsToggleAction(f: FormData) {
  const a = await requireAdmin("support");
  await (await db()).query("update announcements set active = not active where id = $1", [id(f, "news")]);
  await audit(a.id, null, "news.toggle", null, { id: id(f, "news") });
  revalidatePath("/admin/news");
}

export async function staffAction(_: FormState, f: FormData): Promise<FormState> {
  return act("staff", async (adminId) => {
    const username = s(f, "username").toLowerCase(); const role = s(f, "role"); const pw = s(f, "password");
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new RuleError("Username: 3 to 30 letters, numbers, dot or dash.");
    if (!["accounts", "kyc", "support", "viewer", "ca"].includes(role)) throw new RuleError("Choose a role.");
    if (pw.length < 10) throw new RuleError("Staff passwords must be at least 10 characters.");
    try {
      await (await db()).query("insert into admins (username, name, password_hash, role) values ($1, $2, $3, $4)", [username, s(f, "name") || username, await hashPassword(pw), role]);
    } catch { throw new RuleError("That username is taken."); }
    await audit(adminId, null, "staff.create", null, { username, role });
    return `Staff login ${username} created.`;
  }, ["/admin/staff"]);
}

export async function staffToggleAction(f: FormData) {
  const a = await requireAdmin("staff");
  const sid = id(f, "staff");
  if (sid === a.id) return;
  await (await db()).query("update admins set active = not active where id = $1 and role <> 'owner'", [sid]);
  await (await db()).query("delete from sessions where kind = 'admin' and subject_id = $1", [sid]);
  await audit(a.id, null, "staff.toggle", null, { staff: sid });
  revalidatePath("/admin/staff");
}

// ---------- Own security: password and two-step login ----------

export async function adminPasswordAction(_: FormState, f: FormData): Promise<FormState> {
  const a = await requireAdmin();
  const cur = s(f, "current"); const next = s(f, "password");
  if (next.length < 10) return { error: "The new password must be at least 10 characters." };
  if (next !== s(f, "password2")) return { error: "The two new passwords do not match." };
  const d = await db();
  const row = await maybeOne<{ password_hash: string }>(d, "select password_hash from admins where id = $1", [a.id]);
  if (!row || !(await verifyPassword(cur, row.password_hash))) return { error: "The current password is not correct." };
  await d.query("update admins set password_hash = $2 where id = $1", [a.id, await hashPassword(next)]);
  await audit(a.id, null, "admin.password_change", null);
  return { ok: "Password changed." };
}

export async function totpStartAction(f: FormData) {
  void f;
  const a = await requireAdmin();
  await (await db()).query("update admins set totp_secret = $2, totp_enabled = false where id = $1", [a.id, newSecret()]);
  revalidatePath("/admin/security");
}

export async function totpConfirmAction(_: FormState, f: FormData): Promise<FormState> {
  const a = await requireAdmin();
  const d = await db();
  const row = await maybeOne<{ totp_secret: string | null }>(d, "select totp_secret from admins where id = $1", [a.id]);
  if (!row?.totp_secret) return { error: "Start the setup first." };
  if (!verifyTotp(row.totp_secret, s(f, "code"))) return { error: "That code is not correct. Check the time on your phone and try again." };
  await d.query("update admins set totp_enabled = true where id = $1", [a.id]);
  await audit(a.id, null, "admin.2fa_on", null);
  revalidatePath("/admin/security");
  return { ok: "Two-step login is on. You will need a code every time you log in." };
}

export async function totpDisableAction(_: FormState, f: FormData): Promise<FormState> {
  const a = await requireAdmin();
  const d = await db();
  const row = await maybeOne<{ totp_secret: string | null }>(d, "select totp_secret from admins where id = $1", [a.id]);
  if (!row?.totp_secret || !verifyTotp(row.totp_secret, s(f, "code"))) return { error: "Enter a correct code to turn it off." };
  await d.query("update admins set totp_enabled = false, totp_secret = null where id = $1", [a.id]);
  await audit(a.id, null, "admin.2fa_off", null);
  revalidatePath("/admin/security");
  return { ok: "Two-step login is off." };
}

// ---------- Two-person approval for manual wallet changes ----------

export async function approvalDecisionAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const aid = id(f, "approval"); const approve = s(f, "decision") === "approve"; const note = s(f, "note");
    const d = await db();
    await d.tx(async (t) => {
      const r = await maybeOne<{ member_id: unknown; payload: unknown; status: string; requested_by: unknown; reason: string }>(t,
        "select member_id, payload, status, requested_by, reason from approvals where id = $1 for update", [aid]);
      if (!r || r.status !== "pending") throw new RuleError("This request is no longer pending.");
      if (n(r.requested_by) === adminId) throw new RuleError("A different admin must approve this request.");
      const p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as { amountPaise: number };
      if (approve) await adjustWallet(t, { memberId: n(r.member_id), amountPaise: p.amountPaise, note: r.reason, adminId: n(r.requested_by), date: istDate() });
      await t.query("update approvals set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1",
        [aid, approve ? "approved" : "rejected", adminId, note || null]);
    });
    await audit(adminId, null, approve ? "approval.approve" : "approval.reject", note || null, { approval: aid });
    return approve ? "Approved and posted to the wallet." : "Rejected.";
  }, ["/admin/approvals"]);
}

// ---------- Ranks ----------

export async function rankTableAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const note = s(f, "note"); needReason(note);
    const d = await db();
    const levels = (await d.query<{ level: unknown }>("select level from ranks order by level")).map((r) => n(r.level));
    const rows = levels.map((lv) => ({
      level: lv, name: s(f, `name_${lv}`), pairs: Number(s(f, `pairs_${lv}`)), directs: Number(s(f, `directs_${lv}`)),
      reward: Math.round(Number(s(f, `reward_${lv}`)) * 100), inst: Number(s(f, `inst_${lv}`)), active: f.get(`active_${lv}`) === "on",
    }));
    for (const r of rows) {
      if (!r.name || r.name.length > 30) throw new RuleError(`Level ${r.level}: enter a name up to 30 characters.`);
      if (!Number.isInteger(r.pairs) || r.pairs < 1) throw new RuleError(`${r.name}: renewal pairs must be a whole number of at least 1.`);
      if (!Number.isInteger(r.directs) || r.directs < 0) throw new RuleError(`${r.name}: green directs must be a whole number.`);
      if (!Number.isFinite(r.reward) || r.reward < 0) throw new RuleError(`${r.name}: enter the reward in rupees.`);
      if (!Number.isInteger(r.inst) || r.inst < 1 || r.inst > 120) throw new RuleError(`${r.name}: instalments must be between 1 and 120.`);
    }
    const act_ = rows.filter((r) => r.active);
    for (let i = 1; i < act_.length; i++)
      if (act_[i].pairs <= act_[i - 1].pairs) throw new RuleError(`${act_[i].name} must need more pairs than ${act_[i - 1].name}.`);
    await d.tx(async (t) => {
      for (const r of rows)
        await t.query("update ranks set name = $2, renewal_pairs = $3, green_directs = $4, reward_paise = $5, instalments = $6, active = $7, updated_at = now() where level = $1",
          [r.level, r.name, r.pairs, r.directs, r.reward, r.inst, r.active]);
    });
    await audit(adminId, null, "ranks.update", note, rows);
    return "Ranks saved. Changes apply to ranks earned from now on; rewards already earned keep their amounts.";
  }, ["/admin/ranks"]);
}

export async function rewardDecisionAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const memberId = id(f); const level = Number(f.get("level") ?? 0); const approve = s(f, "decision") === "approve"; const note = s(f, "note");
    if (!approve) needReason(note);
    const d = await db();
    const r = await d.query("update reward_instalments set status = $3, decided_by = $4, note = $5 where member_id = $1 and level = $2 and status = 'awaiting_approval' returning id",
      [memberId, level, approve ? "pending" : "cancelled", adminId, note || null]);
    if (!r.length) throw new RuleError("Nothing is waiting for approval for this rank.");
    await audit(adminId, memberId, approve ? "rank_reward.approve" : "rank_reward.cancel", note || null, { level });
    return approve ? "Approved. It is paid at the next closing (within the reward pool)." : "Reward cancelled.";
  }, ["/admin/ranks"]);
}

export async function suiteSyncAction(_: FormState, f: FormData): Promise<FormState> {
  return act("members", async (adminId) => {
    const d = await db();
    await d.query("update suite_sync set status = 'pending', attempts = 0 where member_id = $1 and status <> 'done'", [id(f)]);
    const r = await processSuiteSync(d, 50);
    await audit(adminId, id(f), "suite.sync", null, r);
    return `Shubhora sync: ${r.done} done, ${r.waiting} waiting for email, ${r.failed} failed.`;
  }, ["/admin/members"]);
}

// ---------- Deeper member tools ----------

const newPassword = () => {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => chars[b % chars.length]).join("");
};

/** Generate a new member password, show it once, and prepare a WhatsApp message to the member's mobile. */
export async function generatePasswordAction(_: FormState, f: FormData): Promise<FormState> {
  const a = await requireAdmin("members");
  const memberId = id(f);
  const d = await db();
  const m = await maybeOne<{ code: string; name: string; mobile: string }>(d, "select code, name, mobile from members where id = $1", [memberId]);
  if (!m) return { error: "Member not found." };
  const pw = newPassword();
  await d.query("update members set password_hash = $2 where id = $1", [memberId, await hashPassword(pw)]);
  await d.query("delete from sessions where kind = 'member' and subject_id = $1", [memberId]);
  await syncSuitePassword(d, memberId, pw);
  await d.query("update password_requests set status = 'done', handled_by = $2, handled_at = now() where member_id = $1 and status = 'open'", [memberId, a.id]);
  await audit(a.id, memberId, "member.password_generated", s(f, "reason") || null);
  const { PUBLIC_URL } = process.env;
  const text = `Hello ${m.name.split(" ")[0]}, your Shubhora login (partner panel and Shubhora app):\nID: ${m.code}\nPassword: ${pw}\n${PUBLIC_URL ? `${PUBLIC_URL}/login\n` : ""}In the Shubhora app, log in with your email and this same password. Please change it after logging in (Profile → Change password).`;
  return { ok: "New password created. It is shown only once.", secret: pw, link: { href: `https://wa.me/91${m.mobile}?text=${encodeURIComponent(text)}`, label: "Send on WhatsApp" } };
}

export async function noteAction(_: FormState, f: FormData): Promise<FormState> {
  return act("members", async (adminId) => {
    const body = s(f, "body");
    if (body.length < 2) throw new RuleError("Write the note.");
    await (await db()).query("insert into member_notes (member_id, admin_id, body, pinned) values ($1, $2, $3, $4)", [id(f), adminId, body.slice(0, 1000), f.get("pinned") === "on"]);
    return "Note saved.";
  }, ["/admin/members"]);
}

export async function changeSponsorAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const memberId = id(f); const reason = s(f, "reason"); needReason(reason);
    const d = await db();
    const to = await memberByCode(d, s(f, "sponsor"));
    if (!to) throw new RuleError("New sponsor ID not found.");
    if (n(to.id) === memberId) throw new RuleError("A member cannot sponsor themselves.");
    const cur = await maybeOne<{ sponsor_id: unknown }>(d, "select sponsor_id from members where id = $1", [memberId]);
    if (!cur || cur.sponsor_id === null) throw new RuleError("The company ID has no sponsor.");
    if (n(cur.sponsor_id) === n(to.id)) throw new RuleError("That is already the sponsor.");
    // The new sponsor must not be someone this member introduced (directly or further down): that would make a loop.
    const loop = await d.query(
      `with recursive up as (select id, sponsor_id, 0 as depth from members where id = $1
         union all select m.id, m.sponsor_id, up.depth + 1 from members m join up on m.id = up.sponsor_id where up.depth < 100000)
       select 1 from up where id = $2 limit 1`, [to.id, memberId]);
    if (loop.length) throw new RuleError("That ID is in this member's own sponsor team, so it cannot become the sponsor.");
    await d.tx(async (t) => {
      await t.query("update members set sponsor_id = $2 where id = $1", [memberId, to.id]);
      await t.query("insert into tree_moves (member_id, kind, from_id, to_id, reason, admin_id) values ($1, 'sponsor', $2, $3, $4, $5)", [memberId, cur.sponsor_id, to.id, reason, adminId]);
    });
    await audit(adminId, memberId, "tree.sponsor_change", reason, { from: n(cur.sponsor_id), to: to.code });
    return `Sponsor changed to ${to.code}. Bonuses already paid stay as they are; future Direct Sale and Sponsor Bonus go to the new sponsor.`;
  }, ["/admin/members"]);
}

/** Placement can move only while nobody is under the ID and it has never created volume, so no one's legs change. */
export async function movePlacementAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const memberId = id(f); const reason = s(f, "reason"); needReason(reason);
    const leg = s(f, "leg") === "R" ? "R" : "L";
    const d = await db();
    await d.tx(async (t) => {
      await t.query("select pg_advisory_xact_lock(7140001)");
      const m = await maybeOne<{ parent_id: unknown; leg: string }>(t, "select parent_id, leg from members where id = $1 for update", [memberId]);
      if (!m || m.parent_id === null) throw new RuleError("The company ID cannot move.");
      if (await maybeOne(t, "select 1 from members where parent_id = $1", [memberId])) throw new RuleError("This ID has people under it, so it cannot move. Moving it would change their uplines' volume.");
      if (await maybeOne(t, "select 1 from bv_events where member_id = $1 and closing_id is not null", [memberId])) throw new RuleError("This ID's volume is already counted in closings, so its placement is final.");
      const parent = await memberByCode(t, s(f, "parent"));
      if (!parent) throw new RuleError("New placement ID not found.");
      if (n(parent.id) === memberId) throw new RuleError("Choose a different placement ID.");
      if (await maybeOne(t, "select 1 from members where parent_id = $1 and leg = $2", [parent.id, leg])) throw new RuleError(`The ${leg === "L" ? "left" : "right"} position under ${parent.code} is already filled.`);
      await t.query("update members set parent_id = $2, leg = $3, depth = (select depth + 1 from members where id = $2) where id = $1", [memberId, parent.id, leg]);
      await t.query("insert into tree_moves (member_id, kind, from_id, to_id, leg, reason, admin_id) values ($1, 'placement', $2, $3, $4, $5, $6)", [memberId, m.parent_id, parent.id, leg, reason, adminId]);
    });
    await audit(adminId, memberId, "tree.placement_move", reason, { parent: s(f, "parent"), leg });
    return "Placement changed.";
  }, ["/admin/members"]);
}

export async function companyAction(_: FormState, f: FormData): Promise<FormState> {
  return act("plan", async (adminId) => {
    const d = await db();
    const keys = (await d.query<{ key: string }>("select key from company_settings")).map((r) => r.key);
    const gstin = s(f, "gstin").toUpperCase();
    if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new RuleError("The GSTIN does not look right (15 characters, e.g. 08ABCDE1234F1Z5).");
    await d.tx(async (t) => {
      for (const k of keys) {
        if (f.get(k) === null) continue;
        let v = s(f, k);
        if (k === "gstin") v = gstin;
        if (k === "state_code" && gstin) v = gstin.slice(0, 2);            // the GSTIN decides the state
        if (k === "state_code" && v && !/^\d{2}$/.test(v)) throw new RuleError("State code is 2 digits, e.g. 08 for Rajasthan.");
        await t.query("update company_settings set value = $2, updated_at = now(), updated_by = $3 where key = $1", [k, v.slice(0, 500), adminId]);
      }
    });
    await audit(adminId, null, "company.update", null);
    return "Company details saved. New invoices use them.";
  }, ["/admin/company"]);
}

export async function downloadAction(_: FormState, f: FormData): Promise<FormState> {
  return act("support", async (adminId) => {
    const title = s(f, "title"); const fileId = s(f, "file");
    if (!title) throw new RuleError("Add a title.");
    if (!fileId) throw new RuleError("Upload the file first.");
    await (await db()).query("insert into downloads (title, description, category, file_id) values ($1, $2, $3, $4)", [title, s(f, "description") || null, s(f, "category") || "General", fileId]);
    await audit(adminId, null, "download.add", null, { title });
    return "Added. Members see it under Downloads.";
  }, ["/admin/downloads"]);
}

export async function downloadToggleAction(f: FormData) {
  const a = await requireAdmin("support");
  await (await db()).query("update downloads set active = not active where id = $1", [id(f, "download")]);
  await audit(a.id, null, "download.toggle", null, { id: id(f, "download") });
  revalidatePath("/admin/downloads");
}

export async function passwordRequestCloseAction(f: FormData) {
  const a = await requireAdmin("members");
  await (await db()).query("update password_requests set status = 'rejected', handled_by = $2, handled_at = now() where id = $1 and status = 'open'", [id(f, "request"), a.id]);
  revalidatePath("/admin/passwords");
}

export async function adminKycEditAction(_: FormState, f: FormData): Promise<FormState> {
  return act("kyc", async (adminId) => {
    const memberId = id(f); const reason = s(f, "reason"); needReason(reason);
    const ifsc = s(f, "ifsc").toUpperCase(); const acct = s(f, "account_no").replace(/\s/g, "");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new RuleError("Enter a valid IFSC.");
    if (!/^\d{9,18}$/.test(acct)) throw new RuleError("Enter a valid account number.");
    const d = await db();
    const before = await maybeOne(d, "select bank_name, account_name, account_no, ifsc from kyc where member_id = $1", [memberId]);
    if (!before) throw new RuleError("No KYC on file for this ID.");
    await d.query("update kyc set bank_name = $2, account_name = $3, account_no = $4, ifsc = $5 where member_id = $1",
      [memberId, s(f, "bank_name"), s(f, "account_name"), acct, ifsc]);
    await audit(adminId, memberId, "kyc.bank_change", reason, { before, after: { bank_name: s(f, "bank_name"), account_name: s(f, "account_name"), account_no: acct, ifsc } });
    return "Bank details updated.";
  }, ["/admin/members"]);
}

// ---------- Manual payment requests ----------

export async function paymentRequestDecisionAction(_: FormState, f: FormData): Promise<FormState> {
  return act("money", async (adminId) => {
    const rid = id(f, "request"); const approve = s(f, "decision") === "approve"; const reason = s(f, "reason");
    const d = await db();
    const r = await maybeOne<{ member_id: unknown; status: string }>(d,
      "select member_id, status from payment_requests where id = $1", [rid]);
    if (!r || r.status !== "pending") throw new RuleError("This request is no longer pending.");
    const memberId = n(r.member_id);
    if (!approve) {
      needReason(reason);
      await d.query("update payment_requests set status = 'rejected', reject_reason = $2, decided_by = $3, decided_at = now() where id = $1 and status = 'pending'", [rid, reason, adminId]);
      await audit(adminId, memberId, "payment_request.reject", reason, { request: rid });
      return "Rejected. The member sees your reason.";
    }
    const done = await approvePaymentRequest(d, { requestId: rid, adminId, date: istDate() });
    await audit(adminId, memberId, "payment_request.approve", null, { request: rid, invoice: done.invoiceNo });
    await processSuiteSync(d, 10).catch(() => undefined);
    return `Approved. ${done.kind === "activation" ? "The ID is green" : "Renewed for one month"}; invoice ${done.invoiceNo}.`;
  }, ["/admin/payment-requests", "/admin/members"]);
}
