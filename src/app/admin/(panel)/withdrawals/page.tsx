import Link from "next/link";
import { withBase } from "@/lib/base";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { withdrawalAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Withdrawals" };

export default async function Withdrawals({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireAdmin("money");
  const { s = "pending" } = await searchParams;
  const where = s === "pending" ? "w.status in ('requested','approved')" : "w.status = $1";
  const rows = await (await db()).query<Record<string, unknown>>(
    `select w.*, w.requested_at::text as req, m.code, m.name from withdrawals w join members m on m.id = w.member_id
     where ${where} order by w.id desc limit 300`, s === "pending" ? [] : [s]);
  const total = rows.reduce((a, r) => a + n(r.amount_paise), 0);
  return (
    <div className="space-y-5">
      <PageHead title="Withdrawals" sub={`${rows.length} requests · ${inr(total)}`}>
        <a href={withBase("/admin/reports/export?type=bankfile")} className="btn btn-ghost">Bank file (approved)</a>
      </PageHead>
      <div className="flex gap-1">{[["pending", "Pending"], ["paid", "Paid"], ["rejected", "Rejected"]].map(([k, l]) =>
        <Link key={k} href={`/admin/withdrawals?s=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${s === k ? "bg-brand text-white" : "bg-surface border border-line text-muted"}`}>{l}</Link>)}</div>
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>Member</th><th>Amount</th><th>Pay to</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted">Nothing here.</td></tr>}
            {rows.map((r) => {
              const b = (typeof r.bank_snapshot === "string" ? JSON.parse(r.bank_snapshot) : r.bank_snapshot) as Record<string, string>;
              const pending = r.status === "requested" || r.status === "approved";
              return (
                <tr key={String(r.id)}>
                  <td><span className="text-xs text-faint">#{String(r.id)} · {dateFmt(r.req as string)}</span><br /><Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{r.code as string}</Link><br /><span className="text-xs text-muted">{r.name as string}</span></td>
                  <td className="font-semibold num">{inr(n(r.amount_paise))}</td>
                  <td className="text-xs max-w-[190px]"><b>{b.account_name}</b><br />{b.bank_name}<br /><span className="font-mono">{b.account_no}</span><br /><span className="font-mono">{b.ifsc}</span></td>
                  <td className="capitalize">{r.status as string}{r.utr ? <><br /><span className="text-xs font-mono">UTR {r.utr as string}</span></> : null}{r.reject_reason ? <><br /><span className="text-xs text-red">{r.reject_reason as string}</span></> : null}</td>
                  <td className="w-[300px] min-w-[300px]">{pending && (
                    <div className="space-y-2">
                      {r.status === "requested" && <ActionForm action={withdrawalAction} submit="Approve" className="[&>button]:w-auto"><input type="hidden" name="withdrawal" value={String(r.id)} /><input type="hidden" name="action" value="approve" /></ActionForm>}
                      <ActionForm action={withdrawalAction} submit="Mark paid" className="flex flex-wrap items-start gap-2 [&>button]:w-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap [&>p]:basis-full"><input type="hidden" name="withdrawal" value={String(r.id)} /><input type="hidden" name="action" value="paid" /><input name="utr" placeholder="UTR" required className="input w-[130px]" /></ActionForm>
                      <ActionForm action={withdrawalAction} submit="Reject" danger className="flex flex-wrap items-start gap-2 [&>button]:w-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap [&>p]:basis-full"><input type="hidden" name="withdrawal" value={String(r.id)} /><input type="hidden" name="action" value="reject" /><input name="reason" placeholder="Reason" required className="input w-[130px]" /></ActionForm>
                    </div>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
