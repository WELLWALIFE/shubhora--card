import Link from "next/link";
import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { PageHead } from "@/components/ui";
import { actionLabel, dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Activity log" };

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const { q = "" } = await searchParams;
  const rows = await (await db()).query<Record<string, unknown>>(
    `select l.id, l.action, l.reason, l.detail, l.at::text, a.username, m.code
     from audit_log l left join admins a on a.id = l.admin_id left join members m on m.id = l.member_id
     where $1 = '' or l.action ilike '%' || $1 || '%' or m.code ilike $1 or a.username ilike $1
     order by l.id desc limit 300`, [q.trim()]);
  return (
    <div className="space-y-5">
      <PageHead title="Activity log" sub="Every change made by staff. This log cannot be edited or deleted." />
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Action, member ID or username" className="input max-w-sm" /><button className="btn btn-ghost">Filter</button></form>
      <div className="card overflow-x-auto">
        <table className="grid-table"><thead><tr><th>When</th><th>Staff</th><th>Member</th><th>Action</th><th>Reason</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">No activity yet.</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className="whitespace-nowrap">{dateTimeFmt(r.at as string)}</td>
                <td>{(r.username as string) ?? "system"}</td>
                <td>{r.code ? <Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{r.code as string}</Link> : ""}</td>
                <td className="text-sm">{actionLabel(r.action as string)}<span className="block font-mono text-[10px] text-faint">{r.action as string}</span></td>
                <td>{(r.reason as string) ?? ""}</td>
                <td className="max-w-md truncate font-mono text-[11px] text-faint">{r.detail ? JSON.stringify(typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
