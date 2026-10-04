"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { announceNewMember, linkNewMember, suiteOrigin } from "@/server/suite";
import { verifyTotp } from "@/server/auth/totp";
import { setupTokenOk } from "@/server/auth/setup";
import { endSession, recordFailure, startSession, tooManyAttempts } from "@/server/auth/session";
import { registerMember, RuleError } from "@/server/engine/members";
import { flags, recordLogin } from "@/server/queries";

export type FormState = { error?: string; ok?: string; secret?: string; link?: { href: string; label: string } } | undefined;

async function ipKey(prefix: string) {
  const h = await headers();
  return `${prefix}:${h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
}

export async function memberLogin(_: FormState, form: FormData): Promise<FormState> {
  const idOrMobile = String(form.get("login") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!idOrMobile || !password) return { error: "Enter your ID or mobile number and password." };
  const key = await ipKey("m");
  if (await tooManyAttempts(key)) return { error: "Too many attempts. Try again in 15 minutes." };
  const digits = idOrMobile.replace(/\D/g, "").slice(-10);
  const m = await maybeOne<{ id: unknown; password_hash: string; blocked: boolean }>(await db(),
    "select id, password_hash, blocked from members where upper(code) = upper($1) or mobile = $2 limit 1", [idOrMobile, digits]);
  if (!m || !(await verifyPassword(password, m.password_hash))) {
    await recordFailure(key);
    await recordLogin("member", m ? n(m.id) : null, idOrMobile, false, "wrong password");
    return { error: "ID or password is incorrect." };
  }
  if (m.blocked) { await recordLogin("member", n(m.id), idOrMobile, false, "blocked"); return { error: "This ID is blocked. Contact support." }; }
  await recordLogin("member", n(m.id), idOrMobile, true);
  await startSession("member", n(m.id));
  redirect("/dashboard");
}

export async function memberLogout() {
  // One login for everything, so one logout: the app ends its own session too and shows its sign-in.
  await endSession("member");
  const suite = suiteOrigin();
  redirect(suite ? `${suite}/logout` : "/login?legacy=1");
}

export async function joinAction(_: FormState, form: FormData): Promise<FormState> {
  const f = await flags();
  if (!f["feature.registration"]) return { error: "New registrations are paused right now." };
  if (form.get("agree") !== "on") return { error: "Please accept the partner agreement." };
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("password2") ?? "")) return { error: "The two passwords do not match." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email. Your Shubhora login is created on it." };
  const key = await ipKey("join");
  if (await tooManyAttempts(key, 20)) return { error: "Too many registrations from this network. Try later." };
  try {
    const leg = form.get("leg") === "R" ? "R" : "L";
    const m = await registerMember(await db(), {
      sponsorCode: String(form.get("sponsor") ?? ""),
      leg,
      name: String(form.get("name") ?? ""),
      mobile: String(form.get("mobile") ?? ""),
      email: String(form.get("email") ?? ""),
      password,
      codePrefix: process.env.ID_PREFIX || "SH",
    });
    await recordFailure(key); // counts registrations per IP for the rate limit
    await linkNewMember(await db(), m.id, password);   // same login opens the Shubhora app (basic card until paid)
    await announceNewMember(await db(), m.id);          // welcome email + alert to the company
    await startSession("member", m.id);
    await recordLogin("member", m.id, m.code, true, "joined");
  } catch (e) {
    if (e instanceof RuleError) return { error: e.message };
    throw e;
  }
  redirect("/dashboard?welcome=1");
}

export async function adminLogin(_: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const key = await ipKey("a");
  if (await tooManyAttempts(key, 5)) return { error: "Too many attempts. Try again in 15 minutes." };
  const a = await maybeOne<{ id: unknown; password_hash: string; active: boolean; totp_enabled: boolean; totp_secret: string | null }>(await db(),
    "select id, password_hash, active, totp_enabled, totp_secret from admins where lower(username) = $1", [username]);
  if (!a || !a.active || !(await verifyPassword(password, a.password_hash))) {
    await recordFailure(key);
    await recordLogin("admin", a ? n(a.id) : null, username, false, "wrong password");
    return { error: "Username or password is incorrect." };
  }
  if (a.totp_enabled && a.totp_secret) {
    const code = String(form.get("code") ?? "");
    if (!code) return { error: "Enter the 6-digit code from your authenticator app." };
    if (!verifyTotp(a.totp_secret, code)) {
      await recordFailure(key);
      await recordLogin("admin", n(a.id), username, false, "wrong 2-step code");
      return { error: "The 6-digit code is not correct." };
    }
  }
  await recordLogin("admin", n(a.id), username, true);
  await startSession("admin", n(a.id));
  redirect("/admin");
}

export async function adminLogout() {
  await endSession("admin");
  redirect("/admin/login");
}

export async function ownerSetupAction(_: FormState, form: FormData): Promise<FormState> {
  if (!setupTokenOk(String(form.get("token") ?? ""))) return { error: "This setup link is not valid." };
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return { error: "Username: 3 to 30 letters, numbers, dot or dash." };
  if (password.length < 12) return { error: "Use at least 12 characters for the owner password." };
  if (password !== String(form.get("password2") ?? "")) return { error: "The two passwords do not match." };
  const d = await db();
  const created = await d.tx(async (t) => {
    await t.query("select pg_advisory_xact_lock(7140003)");
    if (await maybeOne(t, "select 1 from admins limit 1")) return null;
    const r = await t.query<{ id: unknown }>("insert into admins (username, name, password_hash, role) values ($1, $2, $3, 'owner') returning id",
      [username, String(form.get("name") ?? "Owner").trim() || "Owner", await hashPassword(password)]);
    return n(r[0].id);
  });
  if (!created) return { error: "The owner login already exists." };
  await startSession("admin", created);
  redirect("/admin/security");
}

export async function forgotAction(_: FormState, form: FormData): Promise<FormState> {
  const f = await flags();
  if (!f["feature.forgot_password"]) return { error: "Please contact support to reset your password." };
  const login = String(form.get("login") ?? "").trim();
  if (login.length < 4) return { error: "Enter your partner ID or registered mobile number." };
  const key = await ipKey("forgot");
  if (await tooManyAttempts(key, 5)) return { error: "Too many requests. Try again in 15 minutes." };
  await recordFailure(key);
  const digits = login.replace(/\D/g, "").slice(-10);
  const d = await db();
  const m = await maybeOne<{ id: unknown; mobile: string }>(d, "select id, mobile from members where upper(code) = upper($1) or mobile = $2 limit 1", [login, digits]);
  const open = m ? await maybeOne(d, "select 1 from password_requests where member_id = $1 and status = 'open'", [m.id]) : null;
  if (m && !open) await d.query("insert into password_requests (member_id, login_text, mobile, message) values ($1, $2, $3, $4)",
    [m.id, login, m.mobile, String(form.get("message") ?? "").slice(0, 300) || null]);
  return { ok: "Request received. The company will send a new password to your registered mobile number on WhatsApp." };
}
