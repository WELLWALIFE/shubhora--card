import Link from "next/link";
import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { PageHead } from "@/components/ui";
import { dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Login history" };

export default async function Logins({ searchParams }: { searchParams: Promise<{ k?: string; failed?: string }> }) {
  await requireAdmin();
  const { k = "member", failed } = await searchParams;
  const rows = await (await db()).query<Record<string, unknown>>(
    `select e.*, e.at::text as at_t, m.code, a.username from login_events e
     left join members m on e.kind = 'member' and m.id = e.subject_id left join admins a on e.kind = 'admin' and a.id = e.subject_id
     where e.kind = $1 and ($2 = '' or not e.ok) order by e.id desc limit 300`, [k, failed ? "1" : ""]);
  const tab = (key: string, label: string, extra = "") => <Link href={`/admin/logins?k=${key}${extra}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${k === key && (extra ? failed : !failed) ? "bg-brand text-white" : "bg-surface border border-line text-muted"}`}>{label}</Link>;
  return (
    <div className="space-y-5">
      <PageHead title="Login history" sub="Every login attempt with time, IP address and device. Watch for many failed attempts on one ID." />
      <div className="flex flex-wrap gap-1">{tab("member", "Members")}{tab("member", "Members · failed", "&failed=1")}{tab("admin", "Staff")}{tab("admin", "Staff · failed", "&failed=1")}</div>
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>When</th><th>Who</th><th>Typed</th><th>Result</th><th>IP</th><th>Device</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">No logins recorded yet.</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className="whitespace-nowrap">{dateTimeFmt(r.at_t as string)}</td>
                <td>{r.code ? <Link href={`/admin/members/${r.code}?tab=history`} className="font-mono text-brand-ink">{r.code as string}</Link> : ((r.username as string) ?? "—")}</td>
                <td className="font-mono text-xs">{r.login_text as string}</td>
                <td className={r.ok ? "text-green font-semibold" : "text-red font-semibold"}>{r.ok ? "Success" : `Failed${r.note ? ` (${r.note})` : ""}`}</td>
                <td className="font-mono text-xs">{(r.ip as string) ?? ""}</td>
                <td className="text-xs text-muted max-w-xs truncate">{(r.user_agent as string) ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
