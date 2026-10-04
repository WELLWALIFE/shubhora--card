import { redirect } from "next/navigation";
import { withBase } from "@/lib/base";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { startSession } from "@/server/auth/session";

// Local development only: open a member or admin session without a password, for screen testing.
// Disabled unless NODE_ENV is development AND DEV_SESSIONS=1 is set, so it can never work in production.

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.DEV_SESSIONS !== "1") return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const d = await db();
  if (u.searchParams.get("admin")) {
    const a = await maybeOne<{ id: unknown }>(d, "select id from admins where username = $1", [u.searchParams.get("admin")]);
    if (!a) return new Response("No such admin", { status: 404 });
    await startSession("admin", n(a.id));
    redirect(withBase("/admin"));
  }
  const m = await maybeOne<{ id: unknown }>(d, "select id from members where code = $1", [u.searchParams.get("member") ?? ""]);
  if (!m) return new Response("No such member", { status: 404 });
  await startSession("member", n(m.id));
  redirect(withBase("/dashboard"));
}
