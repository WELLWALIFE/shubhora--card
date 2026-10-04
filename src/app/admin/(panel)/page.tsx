import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { db } from "@/server";
import { n, one } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { addDays, istDate } from "@/server/engine/dates";
import { InfoTip } from "@/components/info-tip";
import { MiniBars } from "@/components/mini-bars";
import { PageHead } from "@/components/ui";
import { actionLabel, dateFmt, inr, dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Admin" };

/** A number tile that opens the page behind it. */
function Tile({ label, value, hint, href, tone, tip }: { label: string; value: React.ReactNode; hint?: string; href: string; tone?: "green" | "red" | "amber" | "brand"; tip?: string }) {
  const color = { green: "text-green", red: "text-red", amber: "text-amber", brand: "text-brand-ink" }[tone ?? "brand"] ?? "";
  return (
    <Link href={href} className="card p-4 block transition-shadow hover:shadow-lg group">
      <p className="text-xs font-semibold text-muted flex items-center gap-1.5">{label}{tip && <InfoTip title={label}>{tip}</InfoTip>}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight num ${tone ? color : "text-ink"}`}>{value}</p>
      <p className="mt-1 text-xs text-faint flex items-center justify-between">{hint ?? ""}<ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" /></p>
    </Link>
  );
}

export default async function AdminHome() {
  await requireAdmin();
  const d = await db();
  const today = istDate();
  const month = today.slice(0, 7) + "-01";
  const start = addDays(today, -29);
  const k = await one<Record<string, unknown>>(d, `select
      (select count(*) from members) as members,
      (select count(*) from members where status = 'green') as green,
      (select count(*) from members where status = 'red') as red,
      (select count(*) from members where (created_at at time zone 'Asia/Kolkata')::date = $1::date) as joined_today,
      (select count(*) from members where green_date = $1::date) as green_today,
      (select count(*) from payments where kind = 'renewal' and status = 'paid' and business_date = $1::date) as renew_today,
      (select coalesce(sum(base_paise),0) from payments where status = 'paid' and business_date = $1::date) as turnover_today,
      (select coalesce(sum(base_paise),0) from payments where status = 'paid' and business_date >= $2::date) as turnover_month,
      (select coalesce(sum(base_paise),0) from payments where status = 'paid') as turnover_all,
      (select coalesce(sum(gross_paise),0) from incomes i join closings c on c.id = i.closing_id where c.closing_date >= $2::date) as income_month,
      (select coalesce(sum(gross_paise),0) from incomes) as income_all,
      (select coalesce(sum(amount_paise),0) from ledger) as wallets,
      (select count(*) from kyc where status = 'pending') as kyc_pending,
      (select count(*) from withdrawals where status in ('requested','approved')) as wd_pending,
      (select coalesce(sum(amount_paise),0) from withdrawals where status in ('requested','approved')) as wd_amount,
      (select count(*) from tickets where status = 'open') as tickets_open,
      (select count(*) from password_requests where status = 'open') as pw_open,
      (select count(*) from payment_requests where status = 'pending') as pay_pending,
      (select count(*) from approvals where status = 'pending') as approvals_open,
      (select count(*) from reward_instalments where status = 'awaiting_approval') as rewards_waiting,
      (select count(*) from suite_sync where status <> 'done') as suite_waiting,
      (select max(closing_date)::text from closings) as last_closing,
      (select count(*) from members where status = 'green' and sub_valid_until < $1::date) as lapsed,
      (select count(*) from members where status = 'green' and sub_valid_until between $1::date and $1::date + 7) as due_week,
      (select count(*) from members where email is null) as no_email`,
    [today, month]);
  const series = await d.query<Record<string, unknown>>(
    `with days as (select generate_series($1::date, $2::date, interval '1 day')::date as day)
     select days.day::text as day,
       (select count(*) from members m where (m.created_at at time zone 'Asia/Kolkata')::date = days.day) as joined,
       (select count(*) from payments p where p.kind = 'activation' and p.status = 'paid' and p.business_date = days.day) as activated,
       (select count(*) from payments p where p.kind = 'renewal' and p.status = 'paid' and p.business_date = days.day) as renewed
     from days order by days.day`, [start, today]);
  const pick = (key: string) => series.map((r) => ({ day: r.day as string, value: n(r[key]) }));
  const due = await d.query<Record<string, unknown>>(
    "select code, name, mobile, sub_valid_until::text from members where status = 'green' and sub_valid_until between $1::date - 7 and $1::date + 7 order by sub_valid_until limit 8", [today]);
  const top = await d.query<Record<string, unknown>>(
    `select m.code, m.name, sum(i.gross_paise) as total from incomes i join closings c on c.id = i.closing_id join members m on m.id = i.member_id
     where c.closing_date >= $1::date group by m.id order by total desc limit 5`, [month]);
  const recent = await d.query<Record<string, unknown>>(
    `select l.action, l.at::text, a.username, m.code from audit_log l left join admins a on a.id = l.admin_id left join members m on m.id = l.member_id
     order by l.id desc limit 8`);
  const ratio = (t: number, i: number) => (t > 0 ? Math.round((i / t) * 1000) / 10 : 0);
  const rMonth = ratio(n(k.turnover_month), n(k.income_month));
  const lastClosing = k.last_closing as string | null;
  const todo = [
    [n(k.pay_pending), "Manual payments to check", "/admin/payment-requests"],
    [n(k.kyc_pending), "KYC to review", "/admin/kyc"], [n(k.wd_pending), `Withdrawals to pay (${inr(n(k.wd_amount))})`, "/admin/withdrawals"],
    [n(k.pw_open), "Password requests", "/admin/passwords"], [n(k.tickets_open), "Open support tickets", "/admin/support"],
    [n(k.approvals_open), "Wallet changes to approve", "/admin/approvals"], [n(k.rewards_waiting), "Rank rewards to approve", "/admin/ranks"],
    [n(k.suite_waiting), "Shubhora accounts not synced", "/admin/members?f=no_email"],
  ].filter(([c]) => (c as number) > 0) as [number, string, string][];

  // Payout watch: income of the last 7 closings against the turnover (before GST) of the same days.
  const week = await one<{ income: unknown; turnover: unknown }>(d, `select
      (select coalesce(sum(i.gross_paise), 0) from incomes i join closings c on c.id = i.closing_id where c.closing_date > $1::date - 7) as income,
      (select coalesce(sum(base_paise), 0) from payments where status = 'paid' and method <> 'complimentary' and business_date > $1::date - 7) as turnover`, [today]);
  const weekPct = n(week.turnover) > 0 ? Math.round((n(week.income) / n(week.turnover)) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHead title="Dashboard" sub={`Today, ${dateFmt(today)}`} />

      {weekPct > 60 && (
        <Link href="/admin/closing" className="flex items-center gap-2 rounded-xl bg-red-soft px-4 py-3 text-sm font-semibold text-red">
          <AlertTriangle className="h-4 w-4" /> Payout in the last 7 days is {weekPct}% of turnover ({inr(n(week.income))} of {inr(n(week.turnover))}). Above 60% the plan runs at a loss; review the closings.
        </Link>
      )}

      {(!lastClosing || lastClosing < addDays(today, -1)) && (
        <Link href="/admin/closing" className="flex items-center gap-2 rounded-xl bg-amber-soft px-4 py-3 text-sm font-semibold text-amber">
          <AlertTriangle className="h-4 w-4" /> Daily closing is pending{lastClosing ? ` since ${dateFmt(lastClosing)}` : ""}. It runs by itself at midnight; open it to check.
        </Link>
      )}

      {todo.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-bold mb-2">Needs your attention</p>
          <div className="flex flex-wrap gap-2">
            {todo.map(([c, l, h]) => <Link key={l} href={h} className="inline-flex items-center gap-2 rounded-lg bg-red-soft px-3 py-1.5 text-sm font-semibold text-red hover:opacity-80"><span className="rounded-full bg-red px-1.5 text-[11px] text-white num">{c}</span>{l}</Link>)}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-bold mb-2">Today</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="New registrations" value={n(k.joined_today)} href={`/admin/members?by=joined&from=${today}&to=${today}`} hint="Red IDs created today" />
          <Tile label="Activations" value={n(k.green_today)} tone="green" href={`/admin/members?by=activated&from=${today}&to=${today}`} hint="IDs that turned green" />
          <Tile label="Renewals" value={n(k.renew_today)} href={`/admin/payments?from=${today}&to=${today}`} hint="Paid today" />
          <Tile label="Turnover" value={inr(n(k.turnover_today))} href={`/admin/payments?from=${today}&to=${today}`} hint="Before GST" />
        </div>
      </div>

      <div>
        <p className="text-sm font-bold mb-2">Business</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="All members" value={n(k.members).toLocaleString("en-IN")} href="/admin/members" hint={`${n(k.green)} green · ${n(k.red)} red`} />
          <Tile label="Turnover this month" value={inr(n(k.turnover_month))} href={`/admin/payments?from=${month}&to=${today}`} hint={`All time ${inr(n(k.turnover_all))}`} />
          <Tile label="Payout ratio this month" value={`${rMonth}%`} tone={rMonth > 55 ? "red" : "brand"} href="/admin/closing"
            tip="Income paid to members as a share of turnover (before GST). Your plan budget is about 50%. Above that, check the closing report." hint={`All time ${ratio(n(k.turnover_all), n(k.income_all))}%`} />
          <Tile label="Owed to members" value={inr(n(k.wallets))} href="/admin/reports" tip="Total of all wallet balances today: income credited but not yet withdrawn." hint="Wallet balances" />
          <Tile label="Renewals due in 7 days" value={n(k.due_week)} tone="amber" href="/admin/renewals" hint="Remind them on WhatsApp" />
          <Tile label="Lapsed subscriptions" value={n(k.lapsed)} tone="red" href="/admin/renewals?s=lapsed" hint="Not earning renewal income" />
          <Tile label="KYC pending" value={n(k.kyc_pending)} href="/admin/kyc" hint="Waiting for review" />
          <Tile label="Members without email" value={n(k.no_email)} href="/admin/members?f=no_email" tip="These members cannot get a Shubhora Business Suite login until they add an email in their Profile." hint="No Shubhora login" />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <MiniBars title="Registrations" data={pick("joined")} href="/admin/members" />
        <MiniBars title="Activations" data={pick("activated")} href="/admin/members?sort=activated" />
        <MiniBars title="Renewals" data={pick("renewed")} href="/admin/renewals" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 pb-2"><p className="font-bold">Renewals due</p><Link href="/admin/renewals" className="text-sm font-semibold text-brand-ink">All →</Link></div>
          <table className="grid-table"><tbody>
            {due.length === 0 && <tr><td className="py-6 text-center text-muted">Nothing due this week.</td></tr>}
            {due.map((r) => <tr key={r.code as string}><td><Link href={`/admin/members/${r.code}?tab=subscription`} className="font-mono text-brand-ink">{r.code as string}</Link><span className="block text-xs text-muted">{r.name as string}</span></td>
              <td className={`text-right text-xs font-semibold ${String(r.sub_valid_until) < today ? "text-red" : "text-amber"}`}>{dateFmt(r.sub_valid_until as string)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 pb-2"><p className="font-bold">Top earners this month</p><Link href="/admin/reports" className="text-sm font-semibold text-brand-ink">Reports →</Link></div>
          <table className="grid-table"><tbody>
            {top.length === 0 && <tr><td className="py-6 text-center text-muted">No income this month yet.</td></tr>}
            {top.map((r) => <tr key={r.code as string}><td><Link href={`/admin/members/${r.code}?tab=income`} className="font-mono text-brand-ink">{r.code as string}</Link><span className="block text-xs text-muted">{r.name as string}</span></td><td className="text-right num font-semibold">{inr(n(r.total))}</td></tr>)}
          </tbody></table>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 pb-2"><p className="font-bold">Latest staff actions</p><Link href="/admin/audit" className="text-sm font-semibold text-brand-ink">Log →</Link></div>
          <table className="grid-table"><tbody>
            {recent.length === 0 && <tr><td className="py-6 text-center text-muted">No actions yet.</td></tr>}
            {recent.map((r, i) => <tr key={i}><td className="text-xs"><span>{actionLabel(r.action as string)}</span>{r.code ? <Link href={`/admin/members/${r.code}`} className="ml-1 text-brand-ink">{r.code as string}</Link> : null}<span className="block text-faint">{(r.username as string) ?? "system"} · {dateTimeFmt(r.at as string, { year: false })}</span></td></tr>)}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
