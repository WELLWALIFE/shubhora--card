import { FileSpreadsheet } from "lucide-react";
import { withBase } from "@/lib/base";
import { requireAdmin } from "@/server/auth/session";
import { fyOf, istDate } from "@/server/engine/dates";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function Reports() {
  await requireAdmin("reports");
  const today = istDate();
  const month = `${today.slice(0, 7)}-01`;
  const fy = fyOf(today);
  const reports = [
    { t: "GST sales register", d: "Every invoice with taxable value and GST, for GSTR-1 and GSTR-3B.", href: `/admin/reports/export?type=gst&from=${month}&to=${today}`, range: true, type: "gst" },
    { t: "TDS register", d: `Commission and TDS per member for FY ${fy}, for the 26Q return and certificates.`, href: `/admin/reports/export?type=tds&fy=${fy}` },
    { t: "TDS return detail (26Q)", d: "Each credit where TDS was deducted, with PAN, section 194H, date and amount, for the quarterly return.", href: "", range: true, type: "tds26q" },
    { t: "Income report", d: "Every income line from every closing, by member and type.", href: `/admin/reports/export?type=income&from=${month}&to=${today}`, range: true, type: "income" },
    { t: "Rank achievers", d: "Every rank earned, the reward and how much of it is paid.", href: "/admin/reports/export?type=ranks" },
    { t: "Wallet balances", d: "What the company owes each member today.", href: "/admin/reports/export?type=wallets" },
    { t: "Member list", d: "All IDs with status, sponsor, placement and subscription.", href: "/admin/reports/export?type=members" },
    { t: "Bank payout file", d: "Approved withdrawals, ready to upload to your bank.", href: "/admin/reports/export?type=bankfile" },
  ];
  return (
    <div className="space-y-5">
      <PageHead title="Reports & CA" sub="Downloads open in Excel. Staff with the CA role can see this page and nothing that changes data." />
      <div className="grid md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <div key={r.t} className="card p-5">
            <p className="font-bold flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-brand" />{r.t}</p>
            <p className="mt-1 text-sm text-muted">{r.d}</p>
            {r.range ? (
              <form action={withBase("/admin/reports/export")} className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="type" value={r.type} />
                <input type="date" name="from" defaultValue={month} className="input w-auto" aria-label="From" />
                <input type="date" name="to" defaultValue={today} className="input w-auto" aria-label="To" />
                <button className="btn btn-primary">Download</button>
              </form>
            ) : <a href={withBase(r.href)} className="btn btn-primary mt-4">Download</a>}
          </div>
        ))}
      </div>
    </div>
  );
}
