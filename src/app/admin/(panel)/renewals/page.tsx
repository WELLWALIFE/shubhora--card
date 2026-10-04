import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { istDate } from "@/server/engine/dates";
import { InfoTip } from "@/components/info-tip";
import { PageHead } from "@/components/ui";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "Renewals" };

const TABS = [["due", "Due in 7 days"], ["today", "Ending today"], ["lapsed", "Lapsed"], ["renewed", "Renewed this month"]] as const;

export default async function Renewals({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireAdmin();
  const { s = "due" } = await searchParams;
  const today = istDate();
  const where = {
    due: "m.sub_valid_until between $1::date and $1::date + 7", today: "m.sub_valid_until = $1::date",
    lapsed: "m.sub_valid_until < $1::date", renewed: "exists (select 1 from payments p where p.member_id = m.id and p.kind = 'renewal' and p.status = 'paid' and p.business_date >= date_trunc('month', $1::date))",
  }[s as "due"] ?? "true";
  const rows = await (await db()).query<Record<string, unknown>>(
    `select m.code, m.name, m.mobile, m.sub_valid_until::text, s.code as sponsor, s.mobile as sponsor_mobile,
            (select max(business_date)::text from payments p where p.member_id = m.id and p.status = 'paid') as last_paid,
            (select count(*) from payments p where p.member_id = m.id and p.kind = 'renewal' and p.status = 'paid') as renewals
     from members m left join members s on s.id = m.sponsor_id
     where m.status = 'green' and m.parent_id is not null and ${where} order by m.sub_valid_until limit 500`, [today]);
  const days = (x: string) => Math.round((new Date(`${x}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  const msg = (name: string, till: string) => `Hello ${name.split(" ")[0]}, your Shubhora Business Suite subscription ${days(till) < 0 ? "ended" : "ends"} on ${dateFmt(till)}. Renew from your partner panel to keep your tools and renewal income running. Thank you!`;

  return (
    <div className="space-y-5">
      <PageHead title="Renewals" sub="Who needs to renew, and a one-tap WhatsApp reminder for each.">
        <InfoTip title="Why renewals matter" align="right">A member earns renewal income and rank credit only while their own subscription is active, plus a short grace (Plan settings, now 3 days). After 90 days lapsed their new-sale income stops too. A late renewal starts from the payment day, so the missed days are not given back. Remind them a few days before the end date.</InfoTip>
      </PageHead>
      <div className="flex flex-wrap gap-1">{TABS.map(([k, l]) =>
        <Link key={k} href={`/admin/renewals?s=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${s === k ? "bg-brand text-white" : "bg-surface border border-line text-muted"}`}>{l}</Link>)}</div>
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>Member</th><th>Subscription till</th><th>Last payment</th><th>Renewals</th><th>Sponsor</th><th>Remind</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Nobody in this list.</td></tr>}
            {rows.map((r) => {
              const left = days(r.sub_valid_until as string);
              return (
                <tr key={r.code as string}>
                  <td><Link href={`/admin/members/${r.code}?tab=subscription`} className="font-mono text-brand-ink">{r.code as string}</Link><span className="block text-xs text-muted">{r.name as string} · {r.mobile as string}</span></td>
                  <td>{dateFmt(r.sub_valid_until as string)}<span className={`block text-xs font-semibold ${left < 0 ? "text-red" : left <= 3 ? "text-amber" : "text-muted"}`}>{left < 0 ? `lapsed ${-left} days ago` : left === 0 ? "ends today" : `${left} days left`}</span></td>
                  <td>{dateFmt(r.last_paid as string)}</td>
                  <td className="num">{n(r.renewals)}</td>
                  <td className="font-mono text-xs">{(r.sponsor as string) ?? "—"}</td>
                  <td className="whitespace-nowrap">
                    <a className="btn px-2.5 py-1.5 text-xs bg-[#25D366] text-white" target="_blank" rel="noreferrer" href={`https://wa.me/91${r.mobile}?text=${encodeURIComponent(msg(r.name as string, r.sub_valid_until as string))}`}><MessageCircle className="h-3.5 w-3.5" />Member</a>
                    {r.sponsor_mobile ? <a className="btn btn-ghost ml-1 px-2.5 py-1.5 text-xs" target="_blank" rel="noreferrer" href={`https://wa.me/91${r.sponsor_mobile}?text=${encodeURIComponent(`Your direct ${r.name} (${r.code}) ${left < 0 ? "has lapsed" : `renews on ${dateFmt(r.sub_valid_until as string)}`}. Please help them renew.`)}`}>Sponsor</a> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
