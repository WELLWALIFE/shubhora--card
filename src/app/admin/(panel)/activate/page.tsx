import Link from "next/link";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { settingsFor } from "@/server/engine/settings";
import { istDate } from "@/server/engine/dates";
import { PageHead, Stat } from "@/components/ui";
import { ActivateForm } from "@/components/activate-form";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Activate IDs" };

const MODE: Record<string, string> = {
  "free-0bv": "Free · 0 BV", "free-full-bv": "Free · full BV", "paid-full": "Paid (offline)", "paid-part": "Part payment", custom: "Custom",
};

/** Staff Admin → Activate IDs: activate or renew any ID on any terms, and the full record of every admin activation. */
export default async function ActivatePage() {
  await requireAdmin("money");
  const d = await db();
  const { s } = await settingsFor(d, istDate());
  const planPrice = Math.round((s.subscriptionBasePaise * (10000 + s.gstBp)) / 10000 / 100);
  const rows = await d.query<Record<string, unknown>>(
    `select p.id, p.kind, p.method, p.total_paise, p.bv_given, p.months, p.app_plan, p.admin_mode, p.reason, p.reference, p.invoice_no,
            p.status, p.business_date::text as day, p.period_to::text as till, m.code, m.username, m.name, a.name as by_name
     from payments p join members m on m.id = p.member_id left join admins a on a.id = p.created_by
     where p.created_by is not null order by p.id desc limit 300`);
  const month = istDate().slice(0, 7);
  const thisMonth = rows.filter((r) => String(r.day).startsWith(month) && r.status === "paid");
  const free = thisMonth.filter((r) => n(r.total_paise) === 0);
  return (
    <div className="space-y-5">
      <PageHead title="Activate IDs" sub="Turn any ID Green — free, paid, part-paid, with or without BV — and keep a record of every one." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Admin activations this month" value={thisMonth.length} />
        <Stat label="Free this month" value={free.length} />
        <Stat label="BV given this month" value={thisMonth.reduce((a, r) => a + n(r.bv_given), 0).toLocaleString("en-IN")} />
        <Stat label="Money recorded this month" value={inr(thisMonth.reduce((a, r) => a + n(r.total_paise), 0))} tone="green" />
      </div>
      <div className="card p-5">
        <ActivateForm planBv={s.bvPerSubscription} planPrice={planPrice} />
      </div>
      <div className="card overflow-x-auto">
        <div className="px-4 pt-4 pb-2"><h2 className="font-bold">Record of admin activations</h2><p className="text-xs text-muted">Newest first. A mistake is undone with Refund on the member&apos;s page (the BV and any bonus from it are reversed).</p></div>
        <table className="grid-table">
          <thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Terms</th><th>Amount</th><th>BV</th><th>Valid till</th><th>App plan</th><th>Invoice</th><th>Reason</th><th>By</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={12} className="py-8 text-center text-muted">No admin activations yet.</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{dateFmt(r.day as string)}</td>
                <td><Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{(r.username as string) || (r.code as string)}</Link> <span className="text-muted">{r.name as string}</span></td>
                <td className="capitalize">{r.kind as string}</td>
                <td>{MODE[String(r.admin_mode)] ?? (r.method === "complimentary" ? "Complimentary" : "Offline")}{n(r.months) > 1 ? ` · ${n(r.months)} months` : ""}</td>
                <td className="num">{n(r.total_paise) ? inr(n(r.total_paise)) : "Free"}</td>
                <td className="num">{r.bv_given === null ? (r.method === "complimentary" ? "0" : "full") : n(r.bv_given).toLocaleString("en-IN")}</td>
                <td>{dateFmt(r.till as string)}</td>
                <td>{r.app_plan === false ? "No" : "Yes"}</td>
                <td className="font-mono text-xs">{r.invoice_no ? <Link href={`/invoice/${r.id}`} target="_blank" className="text-brand-ink">{r.invoice_no as string}</Link> : "—"}</td>
                <td className="max-w-[260px] truncate" title={String(r.reason ?? "")}>{String(r.reason ?? "").replace(/\s*\[admin: [^\]]+\]$/, "")}{r.reference ? <span className="block font-mono text-[11px] text-faint">{r.reference as string}</span> : null}</td>
                <td>{(r.by_name as string) ?? "—"}</td>
                <td className={r.status === "paid" ? "text-green font-semibold" : "text-red font-semibold"}>{r.status === "paid" ? "done" : "refunded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
