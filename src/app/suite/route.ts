import { redirect } from "next/navigation";
import { withBase } from "@/lib/base";
import { db } from "@/server";
import { getMember } from "@/server/auth/session";
import { processSuiteSync, suiteLoginUrl, suiteOrigin, suiteReady } from "@/server/suite";

// "Open Shubhora" button: sync any pending payments, then send the member into their Suite account.
export async function GET() {
  const me = await getMember();
  if (!me) redirect(withBase("/login"));
  if (!suiteReady()) redirect(withBase("/dashboard?suite=unavailable"));
  if (me.actingAdmin) redirect(withBase("/dashboard?suite=admin"));
  const d = await db();
  await processSuiteSync(d, 20).catch(() => undefined);
  let url: string | null = null;
  try { url = await suiteLoginUrl(d, me.id); } catch { redirect(withBase("/dashboard?suite=error")); }
  if (!url) redirect(withBase("/profile?need=email"));
  if (!url.startsWith(suiteOrigin())) redirect(withBase("/dashboard?suite=error"));
  redirect(url);
}
