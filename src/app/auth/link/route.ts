import { createHash } from "node:crypto";
import { withBase } from "@/lib/base";
import { redirect } from "next/navigation";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { startSession } from "@/server/auth/session";
import { recordLogin } from "@/server/queries";

// One-time pass from the Shubhora Business Suite → member session in the partner panel.
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!t) redirect(withBase("/login"));
  const d = await db();
  const row = await maybeOne<{ member_id: unknown; next: string; code: string }>(d,
    `update link_tokens l set used_at = now() from members m
     where l.token_hash = $1 and l.used_at is null and l.expires_at > now() and m.id = l.member_id and not m.blocked
     returning l.member_id, l.next, m.code`, [createHash("sha256").update(t).digest("hex")]);
  if (!row) redirect(withBase("/login?link=expired"));
  await recordLogin("member", n(row.member_id), row.code, true, "from Shubhora");
  await startSession("member", n(row.member_id));
  // `next`: a page of this panel ("/team", "/wallet"…) — the app passes the page the person asked for — or the
  // two words the first version used.
  const next = row.next === "activate" ? "/activate" : /^\/[a-z0-9][a-z0-9/_-]{0,80}$/i.test(row.next ?? "") ? row.next : "/dashboard";
  redirect(withBase(next));
}
