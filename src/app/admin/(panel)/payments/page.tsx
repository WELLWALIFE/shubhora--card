import Link from "next/link";
import { withBase } from "@/lib/base";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { PageHead, Stat } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Payments" };

export default async function Payments({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; m?: string }> }) {
  await requireAdmin("reports");
  const sp = await searchParams;
  const from = sp.from || new Date().toISOString().slice(0, 8) + "01";
  const to = sp.to || new Date().toISOString().slice(0, 10);
  const method = sp.m ?? "";
  const rows = await (await db()).query<Record<string, unknown>>(
    `select p.*, p.business_date::text as day, m.code, m.name from payments p join members m on m.id = p.member_id
     where p.business_date between $1::date and $2::date and ($3 = '' or p.method = $3) order by p.id desc limit 1000`, [from, to, method]);
  const paid = rows.filter((r) => r.status === "paid");
  const sum = (k: string) => paid.reduce((a, r) => a + n(r[k]), 0);
  return (
    <div className="space-y-5">
      <PageHead title="Payments" sub="Every subscription payment, with its GST invoice.">
        <a className="btn btn-ghost" href={withBase(`/admin/reports/export?type=gst&from=${from}&to=${to}`)}>GST register (Excel)</a>
      </PageHead>
      <form className="flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="m">Method</label><select id="m" name="m" defaultValue={method} className="input"><option value="">All</option><option value="online">Online</option><option value="offline">Offline</option><option value="complimentary">Complimentary</option></select></div>
        <button className="btn btn-ghost">Show</button>
      </form>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Payments" value={paid.length} /><Stat label="Taxable value" value={inr(sum("base_paise"))} />
        <Stat label="GST" value={inr(sum("gst_paise"))} /><Stat label="Total received" value={inr(sum("total_paise"))} tone="green" />
      </div>
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>Date</th><th>Invoice</th><th>Member</th><th>Type</th><th>Method</th><th>Taxable</th><th>GST</th><th>Total</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-muted">No payments in this period.</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{dateFmt(r.day as string)}</td>
                <td className="font-mono text-xs">{r.invoice_no ? <Link href={`/invoice/${r.id}`} target="_blank" className="text-brand-ink">{r.invoice_no as string}</Link> : "—"}</td>
                <td><Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{r.code as string}</Link> <span className="text-muted">{r.name as string}</span></td>
                <td className="capitalize">{r.kind as string}</td><td className="capitalize">{r.method as string}</td>
                <td className="num">{inr(n(r.base_paise))}</td><td className="num">{inr(n(r.gst_paise))}</td><td className="num font-semibold">{inr(n(r.total_paise))}</td>
                <td className="font-mono text-xs">{(r.reference as string) ?? ""}</td>
                <td className={r.status === "paid" ? "text-green font-semibold" : "text-red font-semibold"}>{r.status as string}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
