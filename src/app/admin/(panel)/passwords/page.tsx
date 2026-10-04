import Link from "next/link";
import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { passwordRequestCloseAction } from "@/app/actions/admin";
import { PageHead } from "@/components/ui";
import { dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Password requests" };

export default async function Passwords() {
  await requireAdmin("members");
  const rows = await (await db()).query<Record<string, unknown>>(
    `select r.id, r.login_text, r.mobile, r.message, r.status, r.created_at::text, r.handled_at::text, m.code, m.name, a.username
     from password_requests r left join members m on m.id = r.member_id left join admins a on a.id = r.handled_by
     order by (r.status = 'open') desc, r.id desc limit 200`);
  return (
    <div className="space-y-5">
      <PageHead title="Password requests" sub="Members who used Forgot password. Open the member, create a new password and send it on WhatsApp." />
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>When</th><th>Member</th><th>They typed</th><th>Message</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">No requests.</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className="whitespace-nowrap">{dateTimeFmt(r.created_at as string)}</td>
                <td>{r.code ? <Link href={`/admin/members/${r.code}?tab=manage`} className="font-mono text-brand-ink">{r.code as string}</Link> : "—"}<span className="block text-xs text-muted">{r.name as string} · {r.mobile as string}</span></td>
                <td className="font-mono text-xs">{r.login_text as string}</td>
                <td className="text-muted">{(r.message as string) ?? ""}</td>
                <td className="capitalize">{r.status as string}{r.username ? <span className="block text-xs text-faint">by {r.username as string}</span> : null}</td>
                <td className="whitespace-nowrap">{r.status === "open" && <>
                  <Link href={`/admin/members/${r.code}?tab=manage`} className="btn btn-primary px-2.5 py-1.5 text-xs">New password</Link>
                  <form action={passwordRequestCloseAction} className="inline"><input type="hidden" name="request" value={String(r.id)} /><button className="btn btn-ghost ml-1 px-2.5 py-1.5 text-xs">Dismiss</button></form>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
