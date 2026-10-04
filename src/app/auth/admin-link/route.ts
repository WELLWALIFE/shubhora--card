import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { withBase } from "@/lib/base";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { startSession } from "@/server/auth/session";
import { audit, recordLogin } from "@/server/queries";

// Arrival point from the Shubhora app's Super Admin: one login for both admins.
// The app signs a 60-second, single-use pass with the shared link secret (the mirror of /admin/shubhora, which
// sends the owner the other way). The pass names the app login it was made for (the owner e-mail, or "owner"
// for the password gate); it opens the panel admin whose username is that e-mail, else the company's owner login.
// This deliberately stands in for the panel password AND its 2-step code: the person already passed the app's
// owner login, and the pass never leaves the two servers except in the owner's own browser for a moment.
const used = new Map<string, number>();

function verify(t: string): string | null {
  const secret = process.env.SUITE_LINK_SECRET ?? "";
  if (!secret || !t.startsWith("v1.")) return null;
  const [, body, sig] = t.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { sub?: string; typ?: string; exp?: number };
    if (p.typ !== "panel-admin" || !p.exp || p.exp < Date.now() / 1000) return null;
    if (used.has(body)) return null;                       // single use
    used.set(body, p.exp);
    for (const [k, e] of used) if (e < Date.now() / 1000) used.delete(k);
    return String(p.sub || "owner").slice(0, 120);
  } catch { return null; }
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const sub = t ? verify(t) : null;
  if (!sub) redirect(withBase("/admin/login?link=expired"));
  const d = await db();
  const a = await maybeOne<{ id: unknown; username: string }>(d,
    `select id, username from admins where active and (lower(username) = lower($1) or role = 'owner')
     order by (lower(username) = lower($1)) desc, id limit 1`, [sub]);
  if (!a) redirect(withBase("/admin/login?link=noowner"));
  await recordLogin("admin", n(a.id), a.username, true, `from Shubhora app (${sub})`);
  await audit(n(a.id), null, "admin.login_from_app", null, { sub });
  await startSession("admin", n(a.id));
  redirect(withBase("/admin"));
}
