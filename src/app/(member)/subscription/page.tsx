import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { subscriptionHistory } from "@/server/queries";
import { InfoTip } from "@/components/info-tip";
import { PageHead } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Subscription" };

export default async function Subscription() {
  const me = await requireMember();
  const s = await subscriptionHistory(me.id);
  const tone = s.state === "lapsed" ? "text-red" : s.state === "due soon" ? "text-amber" : "text-green";
  return (
    <div className="space-y-6">
      <PageHead title="Subscription and renewals" sub="Your Shubhora Business Suite subscription, every payment and every invoice.">
        <Link href="/activate" className="btn btn-primary">{me.status === "green" ? "Renew now" : "Activate now"}</Link>
      </PageHead>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card k="Activated on" v={s.activation ? dateFmt(s.activation.paidOn) : "Not yet"} tip="The day your first subscription was paid and your ID turned green." />
        <Card k="Valid till" v={<span className={tone}>{dateFmt(s.validTill)}</span>}
          sub={s.daysLeft === null ? "" : s.daysLeft >= 0 ? `${s.daysLeft} days left` : `Ended ${-s.daysLeft} days ago`} />
        <Card k="Last renewal" v={s.lastRenewal ? dateFmt(s.lastRenewal.paidOn) : "None yet"}
          sub={s.lastRenewal?.delayDays ? (s.lastRenewal.delayDays > 0 ? `${s.lastRenewal.delayDays} days late` : `${-s.lastRenewal.delayDays} days early`) : s.lastRenewal ? "On time" : ""} />
        <Card k="Renewals paid" v={String(s.renewalsCount)} sub={s.lateCount ? `${s.lateCount} late` : "All on time"}
          tip="A renewal is late when it is paid after the previous month ended. It then starts from the day you pay. Renewal income keeps running for 3 days of grace after the end date; after that it pauses until you renew. After 90 days lapsed, new-sale income stops too." />
      </div>
      {s.state !== "active" && s.state !== "none" && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 ${s.state === "lapsed" ? "bg-red-soft text-red" : "bg-amber-soft text-amber"}`}>
          <CalendarClock className="h-4 w-4" />{s.state === "lapsed" ? "Your subscription has ended. Renew to start earning renewal income again." : `Your subscription ends in ${s.daysLeft} days. Renew early; the new month starts after the current one ends, so you lose nothing.`}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>Paid on</th><th>For</th><th>Period</th><th>On time?</th><th>Amount</th><th>Invoice</th><th>Status</th></tr></thead>
          <tbody>
            {s.rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">No payments yet.</td></tr>}
            {s.rows.map((x) => (
              <tr key={x.id}>
                <td className="whitespace-nowrap">{dateFmt(x.paidOn)}</td><td className="capitalize">{x.kind}</td>
                <td className="whitespace-nowrap">{dateFmt(x.from)} – {dateFmt(x.to)}</td>
                <td>{x.delayDays === null ? "—" : x.delayDays > 0 ? <span className="text-red font-semibold">{x.delayDays} days late</span> : <span className="text-green">{x.delayDays < 0 ? `${-x.delayDays} days early` : "On time"}</span>}</td>
                <td className="num">{inr(x.total)}</td>
                <td>{x.invoice ? <Link href={`/invoice/${x.id}`} target="_blank" className="font-mono text-xs text-brand-ink">{x.invoice}</Link> : "—"}</td>
                <td className={x.status === "paid" ? "text-green font-semibold" : "text-red font-semibold"}>{x.status === "paid" ? "Paid" : "Refunded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ k, v, sub, tip }: { k: string; v: React.ReactNode; sub?: string; tip?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-muted flex items-center gap-1.5">{k}{tip && <InfoTip title={k}>{tip}</InfoTip>}</p>
      <p className="mt-1.5 text-xl font-bold">{v}</p>
      {sub ? <p className="mt-0.5 text-xs text-faint">{sub}</p> : null}
    </div>
  );
}
