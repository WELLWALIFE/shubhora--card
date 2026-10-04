import { redirect } from "next/navigation";
import { db } from "@/server";
import { memberByHandle } from "@/server/engine/members";
import { suiteOrigin } from "@/server/suite";

// Joining now happens inside the Shubhora app: one sign-up makes the account AND the partner account, and the
// introducer travels in the link. Old joining links (?s=SH100245&l=L) keep working — the SH code becomes the
// introducer's username when they have one. The side is placed automatically.
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ s?: string; sponsor?: string; ref?: string; by?: string; leg?: string }> }) {
  const q = await searchParams;
  const handle = (q.by || q.s || q.sponsor || q.ref || "").trim();
  let by = handle;
  if (handle) {
    // Best effort: a database hiccup must never break a joining link — the app resolves the handle itself.
    try {
      const m = await memberByHandle(await db(), handle);
      if (m) by = m.username || m.code;
    } catch { /* fall through with the handle as it came */ }
  }
  const suite = suiteOrigin() || "https://shubhora.com";
  const leg = q.leg === "L" || q.leg === "R" ? q.leg : "";
  redirect(`${suite}/signup${by ? `?by=${encodeURIComponent(by)}${leg ? `&leg=${leg}` : ""}` : ""}`);
}
