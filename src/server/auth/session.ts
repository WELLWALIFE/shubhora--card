import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { BASE } from "@/lib/base";
import { db } from "../index";
import { maybeOne, n } from "../db";
import { suiteOrigin } from "../suite";

const COOKIE = { member: "sp_m", admin: "sp_a" } as const;
const DAYS = { member: 30, admin: 1 } as const;
type Kind = keyof typeof COOKIE;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(kind: Kind, subjectId: number, actingAdmin: number | null = null) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const d = await db();
  await d.query(
    `insert into sessions (token_hash, kind, subject_id, acting_admin, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6, $7)`,
    [hash(token), kind, subjectId, actingAdmin, String(DAYS[kind]),
     h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, h.get("user-agent")?.slice(0, 300) ?? null]);
  (await cookies()).set(COOKIE[kind], token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: BASE || "/",
    maxAge: DAYS[kind] * 86400,
  });
}

export async function endSession(kind: Kind) {
  const jar = await cookies();
  const token = jar.get(COOKIE[kind])?.value;
  if (token) await (await db()).query("delete from sessions where token_hash = $1", [hash(token)]);
  jar.delete({ name: COOKIE[kind], path: BASE || "/" });
}

async function current(kind: Kind) {
  const token = (await cookies()).get(COOKIE[kind])?.value;
  if (!token) return null;
  const row = await maybeOne<{ subject_id: unknown; acting_admin: unknown }>(await db(),
    "select subject_id, acting_admin from sessions where token_hash = $1 and kind = $2 and expires_at > now()",
    [hash(token), kind]);
  return row ? { id: n(row.subject_id), actingAdmin: row.acting_admin === null ? null : n(row.acting_admin) } : null;
}

/** `handle`: what people see everywhere — the app username, or the SH code for IDs from before app accounts. */
export type MemberSession = { id: number; code: string; handle: string; name: string; status: "red" | "green"; actingAdmin: number | null };

export async function getMember(): Promise<MemberSession | null> {
  const s = await current("member");
  if (!s) return null;
  const m = await maybeOne<{ code: string; username: string | null; name: string; status: "red" | "green"; blocked: boolean }>(await db(),
    "select code, username, name, status, blocked from members where id = $1", [s.id]);
  if (!m || m.blocked) return null;
  return { id: s.id, code: m.code, handle: m.username || m.code, name: m.name, status: m.status, actingAdmin: s.actingAdmin };
}

export async function requireMember(): Promise<MemberSession> {
  const m = await getMember();
  if (!m) redirect(await signInUrl());
  return m;
}

/** Where a visitor without a session goes. One login for everything: the Shubhora app signs the person in (or
 *  already has) and hands them straight back to the page they wanted, through its /api/partner-panel. The panel's
 *  own password form remains only for partner IDs from before the app accounts (/login?legacy=1). */
export async function signInUrl(): Promise<string> {
  let path = "/dashboard";
  try {
    const p = (await headers()).get("x-pathname") || "";
    const rel = BASE && p.startsWith(BASE) ? p.slice(BASE.length) : p;
    if (/^\/[a-z0-9][a-z0-9/_-]{0,80}$/i.test(rel) && !/^\/(login|auth|join|logout)/.test(rel)) path = rel;
  } catch { /* outside a request */ }
  const suite = suiteOrigin();
  return suite ? `${suite}/api/partner-panel?next=${encodeURIComponent(path)}` : "/login?legacy=1";
}

export type AdminRole = "owner" | "accounts" | "kyc" | "support" | "viewer" | "ca";
export type AdminSession = { id: number; name: string; username: string; role: AdminRole };

export async function getAdmin(): Promise<AdminSession | null> {
  const s = await current("admin");
  if (!s) return null;
  const a = await maybeOne<{ name: string; username: string; role: AdminRole; active: boolean }>(await db(),
    "select name, username, role, active from admins where id = $1", [s.id]);
  if (!a || !a.active) return null;
  return { id: s.id, ...a };
}

/** Which roles may do what. Owner may do everything. */
export const PERMS = {
  view: ["owner", "accounts", "kyc", "support", "viewer", "ca"],
  members: ["owner", "support"],
  money: ["owner", "accounts"],
  kyc: ["owner", "kyc"],
  support: ["owner", "support"],
  plan: ["owner"],
  staff: ["owner"],
  reports: ["owner", "accounts", "ca", "viewer"],
} as const satisfies Record<string, readonly AdminRole[]>;
export type Perm = keyof typeof PERMS;

export const can = (a: AdminSession, p: Perm) => (PERMS[p] as readonly string[]).includes(a.role);

export async function requireAdmin(p: Perm = "view"): Promise<AdminSession> {
  const a = await getAdmin();
  if (!a) redirect("/admin/login");
  if (!can(a, p)) throw new Error("You do not have permission for this action.");
  return a;
}

/** Simple brute-force guard: at most `max` failed attempts per key in 15 minutes. */
export async function tooManyAttempts(key: string, max = 8): Promise<boolean> {
  const d = await db();
  const r = await d.query<{ c: unknown }>(
    "select count(*) as c from login_attempts where key = $1 and at > now() - interval '15 minutes'", [key]);
  return n(r[0].c) >= max;
}
export async function recordFailure(key: string) {
  await (await db()).query("insert into login_attempts (key) values ($1)", [key]);
}
