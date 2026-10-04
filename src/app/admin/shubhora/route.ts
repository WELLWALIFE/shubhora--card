import { redirect } from "next/navigation";
import { withBase } from "@/lib/base";
import { getAdmin } from "@/server/auth/session";
import { audit } from "@/server/queries";
import { suiteAdminHandoff, suiteOrigin, suiteReady } from "@/server/suite";

// Owner only: open the Shubhora app's own admin (cards, pages, plans) without a second password.
// The pass is signed with the shared link secret, works once, and only for 60 seconds.
export async function GET(req: Request) {
  const a = await getAdmin();
  if (!a) redirect(withBase("/admin/login"));
  if (a.role !== "owner" || !suiteReady()) redirect(withBase("/admin"));
  await audit(a.id, null, "admin.open_shubhora_admin", null);
  const to = new URL(req.url).searchParams.get("to") === "users" ? "&to=users" : "";
  redirect(`${suiteOrigin()}/admin-link?t=${encodeURIComponent(suiteAdminHandoff(a.username))}${to}`);
}
