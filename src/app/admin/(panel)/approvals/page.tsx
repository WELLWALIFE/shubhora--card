import Link from "next/link";
import { db } from "@/server";
import { n } from "@/server/db";
import { can, requireAdmin } from "@/server/auth/session";
import { approvalDecisionAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Approvals" };

export default async function Approvals() {
  const a = await requireAdmin();
  const rows = await (await db()).query<Record<string, unknown>>(
    `select p.*, p.requested_at::text as req, m.code, m.name, r.username as by_user, d.username as decided_user
     from approvals p join members m on m.id = p.member_id join admins r on r.id = p.requested_by left join admins d on d.id = p.decided_by
     order by (p.status = 'pending') desc, p.id desc limit 200`);
  const owner = can(a, "plan");
  return (
    <div className="space-y-5">
      <PageHead title="Approvals" sub="Manual wallet changes made by staff wait here until the owner approves them." />
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>Requested</th><th>By</th><th>Member</th><th>Change</th><th>Reason</th><th>Status</th>{owner && <th>Decision</th>}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">No requests.</td></tr>}
            {rows.map((r) => {
              const p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as { amountPaise: number };
              return (
                <tr key={String(r.id)}>
                  <td>{dateFmt(r.req as string)}</td><td>{r.by_user as string}</td>
                  <td><Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{r.code as string}</Link> {r.name as string}</td>
                  <td className={`font-semibold num ${p.amountPaise < 0 ? "text-red" : "text-green"}`}>{p.amountPaise < 0 ? "Debit " : "Credit "}{inr(Math.abs(n(p.amountPaise)))}</td>
                  <td>{r.reason as string}</td>
                  <td className="capitalize">{r.status as string}{r.decided_user ? ` by ${r.decided_user}` : ""}</td>
                  {owner && <td className="min-w-[220px]">{r.status === "pending" && (
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={approvalDecisionAction} submit="Approve" className="[&>button]:w-auto"><input type="hidden" name="approval" value={String(r.id)} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                      <ActionForm action={approvalDecisionAction} submit="Reject" danger className="[&>button]:w-auto"><input type="hidden" name="approval" value={String(r.id)} /><input type="hidden" name="decision" value="reject" /></ActionForm>
                    </div>)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
