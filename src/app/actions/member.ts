"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { requireMember } from "@/server/auth/session";
import { istDate } from "@/server/engine/dates";
import { RuleError } from "@/server/engine/members";
import { requestWithdrawal } from "@/server/engine/wallet";
import { audit, flags, isInTeam } from "@/server/queries";
import { ownsFile } from "@/server/files";
import type { FormState } from "./auth";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function guard<T>(fn: () => Promise<T>): Promise<FormState | T> {
  try { return await fn(); } catch (e) { if (e instanceof RuleError) return { error: e.message }; throw e; }
}

export async function withdrawAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  if (!(await flags())["feature.withdrawals"]) return { error: "Withdrawals are paused right now." };
  const rupees = Number(s(form, "amount"));
  if (!Number.isFinite(rupees) || rupees <= 0) return { error: "Enter an amount in rupees." };
  return guard(async () => {
    await requestWithdrawal(await db(), me.id, Math.round(rupees * 100), istDate());
    if (me.actingAdmin) await audit(me.actingAdmin, me.id, "withdrawal.request_as_member", null, { rupees });
    revalidatePath("/wallet");
    return { ok: "Withdrawal requested. You will see the bank reference here once it is paid." };
  });
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export async function kycAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  const pan = s(form, "pan").toUpperCase();
  const ifsc = s(form, "ifsc").toUpperCase();
  const acct = s(form, "account_no").replace(/\s/g, "");
  const aadhaar = s(form, "aadhaar").replace(/\D/g, "");
  if (!PAN.test(pan)) return { error: "Enter a valid PAN, for example ABCDE1234F." };
  if (!IFSC.test(ifsc)) return { error: "Enter a valid IFSC code, for example SBIN0001234." };
  if (!/^\d{9,18}$/.test(acct)) return { error: "Enter a valid bank account number." };
  if (acct !== s(form, "account_no2").replace(/\s/g, "")) return { error: "The two account numbers do not match." };
  if (aadhaar && aadhaar.length !== 12) return { error: "Aadhaar must be 12 digits." };
  const d = await db();
  const existing = await d.query<{ status: string }>("select status from kyc where member_id = $1", [me.id]);
  if (existing[0]?.status === "approved") return { error: "Your KYC is already approved. Contact support to change bank details." };
  const dupPan = await d.query("select 1 from members where upper(pan) = $1 and id <> $2", [pan, me.id]);
  if (dupPan.length) return { error: "This PAN is already used by another ID." };
  const panFile = await ownsFile(s(form, "pan_file"), me.id, "kyc_pan");
  const bankFile = await ownsFile(s(form, "bank_file"), me.id, "kyc_bank");
  if (!panFile) return { error: "Upload a photo of your PAN card." };
  if (!bankFile) return { error: "Upload a photo of a cancelled cheque or your passbook's first page." };
  const af = await ownsFile(s(form, "aadhaar_front_file"), me.id, "kyc_aadhaar_front");
  const ab = await ownsFile(s(form, "aadhaar_back_file"), me.id, "kyc_aadhaar_back");
  await d.tx(async (t) => {
    await t.query(
      `insert into kyc (member_id, pan, pan_name, aadhaar_last4, bank_name, account_name, account_no, ifsc, nominee, address, gstin,
                        pan_file, bank_file, aadhaar_front_file, aadhaar_back_file, status, submitted_at, reject_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending', now(), null)
       on conflict (member_id) do update set pan = excluded.pan, pan_name = excluded.pan_name, aadhaar_last4 = excluded.aadhaar_last4,
         bank_name = excluded.bank_name, account_name = excluded.account_name, account_no = excluded.account_no, ifsc = excluded.ifsc,
         nominee = excluded.nominee, address = excluded.address, gstin = excluded.gstin, pan_file = excluded.pan_file, bank_file = excluded.bank_file,
         aadhaar_front_file = excluded.aadhaar_front_file, aadhaar_back_file = excluded.aadhaar_back_file,
         status = 'pending', submitted_at = now(), reject_reason = null`,
      [me.id, pan, s(form, "pan_name"), aadhaar ? aadhaar.slice(-4) : null, s(form, "bank_name"), s(form, "account_name"), acct, ifsc,
       s(form, "nominee") || null, s(form, "address") || null, s(form, "gstin").toUpperCase() || null, panFile, bankFile, af, ab]);
  });
  revalidatePath("/kyc");
  return { ok: "KYC submitted. We will review it shortly." };
}

export async function ticketAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  const subject = s(form, "subject");
  const body = s(form, "body");
  const ticketId = Number(form.get("ticket") ?? 0);
  if (!body) return { error: "Write your message." };
  const d = await db();
  if (ticketId) {
    const own = await d.query("select 1 from tickets where id = $1 and member_id = $2", [ticketId, me.id]);
    if (!own.length) return { error: "Ticket not found." };
    await d.query("insert into ticket_messages (ticket_id, body, file_id) values ($1, $2, $3)", [ticketId, body, await ownsFile(s(form, "file"), me.id, "ticket")]);
    await d.query("update tickets set status = 'open', updated_at = now() where id = $1", [ticketId]);
  } else {
    if (!subject) return { error: "Add a subject." };
    const fileId = await ownsFile(s(form, "file"), me.id, "ticket");
    await d.tx(async (t) => {
      const r = await t.query<{ id: unknown }>("insert into tickets (member_id, subject) values ($1, $2) returning id", [me.id, subject]);
      await t.query("insert into ticket_messages (ticket_id, body, file_id) values ($1, $2, $3)", [r[0].id, body, fileId]);
    });
  }
  revalidatePath("/support");
  return { ok: "Sent. Our team will reply here." };
}

export async function profileAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  const email = s(form, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  const d = await db();
  const linked = await d.query<{ suite_user_id: string | null }>("select suite_user_id from members where id = $1", [me.id]);
  if (linked[0]?.suite_user_id) return { error: "Your Shubhora login is already set up on your current email. Contact support to change it." };
  await d.query("update members set email = $2 where id = $1", [me.id, email]);
  const { processSuiteSync } = await import("@/server/suite");
  await processSuiteSync(d, 20).catch(() => undefined);
  revalidatePath("/profile");
  return { ok: "Saved." };
}

export async function memberPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  const next = s(form, "password");
  if (next.length < 8) return { error: "The new password must be at least 8 characters." };
  if (next !== s(form, "password2")) return { error: "The two new passwords do not match." };
  const d = await db();
  const row = await d.query<{ password_hash: string }>("select password_hash from members where id = $1", [me.id]);
  if (!row[0] || !(await verifyPassword(s(form, "current"), row[0].password_hash))) return { error: "The current password is not correct." };
  await d.query("update members set password_hash = $2 where id = $1", [me.id, await hashPassword(next)]);
  const { syncSuitePassword } = await import("@/server/suite");
  await syncSuitePassword(d, me.id, next);
  return { ok: "Password changed. Your Shubhora app password is the same new one." };
}

export async function photoAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  if (!(await flags())["feature.photo_upload"]) return { error: "Photo upload is turned off." };
  const id = await ownsFile(s(form, "photo"), me.id, "photo");
  await (await db()).query("update members set photo_file = $2 where id = $1", [me.id, id]);
  revalidatePath("/profile");
  return { ok: id ? "Photo saved." : "Photo removed." };
}

/** Member sends proof of a manual payment (for their own ID or a Red / renewing ID in their team). */
export async function paymentRequestAction(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireMember();
  const d = await db();
  const forCode = s(form, "for_code").toUpperCase() || me.code;
  const target = await d.query<{ id: unknown; code: string; status: string; blocked: boolean }>("select id, code, status, blocked from members where upper(code) = $1", [forCode]);
  if (!target[0]) return { error: `ID ${forCode} not found.` };
  const t = target[0]; const tid = Number(t.id);
  if (tid !== me.id && !(await isInTeam(me.id, tid))) return { error: "You can pay only for your own ID or an ID in your team." };
  if (t.blocked) return { error: "This ID is blocked. Contact support." };
  const kind = t.status === "green" ? "renewal" : "activation";
  const method = s(form, "method");
  if (!["upi", "bank", "cash", "cheque"].includes(method)) return { error: "Choose how you paid." };
  const reference = s(form, "reference").replace(/\s+/g, "");
  if (reference.length < 4) return { error: method === "cash" ? "Enter the receipt number or the name of the person you paid." : "Enter the UTR / transaction number of the payment." };
  const paidOn = s(form, "paid_on");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > istDate()) return { error: "Enter the date you paid (not a future date)." };
  const rupees = Number(s(form, "amount"));
  if (!Number.isFinite(rupees) || rupees <= 0) return { error: "Enter the amount you paid." };
  const fileId = await ownsFile(s(form, "file"), me.id, "payment");
  if (!fileId && method !== "cash") return { error: "Upload a screenshot or photo of the payment." };
  const open = await d.query("select 1 from payment_requests where member_id = $1 and status = 'pending'", [tid]);
  if (open.length) return { error: `A payment for ${t.code} is already waiting for approval. Please wait for the company to check it.` };
  try {
    await d.query(
      `insert into payment_requests (member_id, submitted_by, kind, amount_paise, method, reference, paid_on, file_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tid, me.id, kind, Math.round(rupees * 100), method, reference, paidOn, fileId, s(form, "note") || null]);
  } catch {
    return { error: "This transaction number was already sent. Check the number, or contact support." };
  }
  if (me.actingAdmin) await audit(me.actingAdmin, tid, "payment_request.submit_as_member", null, { reference });
  revalidatePath("/activate");
  return { ok: `Sent. The company will check the payment and ${kind === "activation" ? "activate" : "renew"} ${t.code}. You will see the status below.` };
}
