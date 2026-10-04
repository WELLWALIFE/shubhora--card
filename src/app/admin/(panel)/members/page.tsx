import Link from "next/link";
import { LogIn } from "lucide-react";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin, can } from "@/server/auth/session";
import { istDate } from "@/server/engine/dates";
import { adminRegisterAction, loginAsAction } from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { InfoTip } from "@/components/info-tip";
import { IdBadge, PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Members" };

const FILTERS = [["all", "All"], ["green", "Green"], ["red", "Red"], ["due", "Renewal due (7 days)"], ["lapsed", "Lapsed"],
  ["kyc_pending", "KYC pending"], ["no_kyc", "No KYC"], ["blocked", "Blocked"], ["hold", "Income on hold"], ["no_email", "No email"]] as const;
const SORTS = [["new", "Newest first"], ["old", "Oldest first"], ["activated", "Recently activated"], ["expiry", "Subscription ending first"], ["wallet", "Highest wallet"], ["login", "Recent login"]] as const;

export default async function Members({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const a = await requireAdmin();
  const sp = await searchParams;
  const q = sp.q ?? ""; const f = sp.f ?? "all"; const sort = sp.sort ?? "new"; const add = sp.add;
  const from = sp.from ?? ""; const to = sp.to ?? ""; const by = sp.by === "activated" ? "activated" : "joined";
  const page = Math.max(1, Number(sp.p) || 1);
  const today = istDate();
  const where: Record<string, string> = {
    all: "true", green: "m.status = 'green'", red: "m.status = 'red'", blocked: "m.blocked", hold: "m.income_hold",
    due: "m.status = 'green' and m.sub_valid_until between $2::date and $2::date + 7",
    lapsed: "m.status = 'green' and m.sub_valid_until < $2::date",
    kyc_pending: "k.status = 'pending'", no_kyc: "k.member_id is null", no_email: "m.email is null",
  };
  const dateCol = by === "activated" ? "m.green_date" : "(m.created_at at time zone 'Asia/Kolkata')::date";
  const order: Record<string, string> = {
    new: "m.id desc", old: "m.id", activated: "m.green_date desc nulls last, m.id desc", expiry: "m.sub_valid_until nulls last, m.id",
    wallet: "wallet desc, m.id desc", login: "m.last_login_at desc nulls last",
  };
  const d = await db();
  const rows = await d.query<Record<string, unknown>>(
    `select m.id, m.code, m.name, m.mobile, m.status, m.green_kind, m.green_date::text, m.blocked, m.income_hold, m.sub_valid_until::text,
            m.created_at::text, m.last_login_at::text, s.code as sponsor_code, s.username as sponsor_username, k.status as kyc,
            (select coalesce(sum(amount_paise), 0) from ledger l where l.member_id = m.id) as wallet,
            (select max(p.business_date)::text from payments p where p.member_id = m.id and p.kind = 'renewal' and p.status = 'paid') as last_renewal,
            (select r.rank_name from member_ranks r where r.member_id = m.id order by r.level desc limit 1) as rank,
            count(*) over () as total
     from members m left join members s on s.id = m.sponsor_id left join kyc k on k.member_id = m.id
     where ${where[f] ?? "true"} and $2::date is not null
       and ($1 = '' or m.code ilike '%' || $1 || '%' or m.name ilike '%' || $1 || '%' or m.mobile like '%' || $1 || '%'
            or coalesce(m.email, '') ilike '%' || $1 || '%' or upper(coalesce(m.pan, '')) = upper($1))
       and ($4 = '' or ${dateCol} >= nullif($4, '')::date) and ($5 = '' or ${dateCol} <= nullif($5, '')::date)
     order by ${order[sort] ?? order.new} limit 50 offset $3`, [q.trim(), today, (page - 1) * 50, from, to]);
  const total = n(rows[0]?.total);
  const qs = (x: Record<string, string>) => new URLSearchParams({ q, f, sort, from, to, by, ...x }).toString();
  const days = (dstr: string | null) => (dstr ? Math.round((new Date(`${dstr}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null);

  return (
    <div className="space-y-5">
      <PageHead title="Members" sub={`${total.toLocaleString("en-IN")} found`}>
        <a href={withBase(`/admin/reports/export?type=members&f=${f}&q=${encodeURIComponent(q)}`)} className="btn btn-ghost">Export Excel</a>
        {can(a, "members") && <Link href={`/admin/members?${qs({ add: "1" })}`} className="btn btn-primary">Add member</Link>}
      </PageHead>

      {add && can(a, "members") && (
        <div className="card p-5 max-w-3xl">
          <p className="font-bold mb-4 flex items-center gap-2">Register a member (starts as Red) <InfoTip title="Adding a member">Leave &quot;exact placement&quot; empty to place at the bottom of the sponsor&apos;s chosen side, the same as the joining link. Give an exact ID to fill a specific empty spot inside the sponsor&apos;s team.</InfoTip></p>
          <ActionForm action={adminRegisterAction} submit="Create ID">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Sponsor ID" name="sponsor" required />
              <Field label="Exact placement under ID (optional)" name="parent" />
              <div><label className="label" htmlFor="leg">Side</label><select id="leg" name="leg" className="input"><option value="L">Left</option><option value="R">Right</option></select></div>
              <Field label="Full name" name="name" required />
              <Field label="Mobile" name="mobile" required />
              <Field label="Email" name="email" />
              <Field label="Password" name="password" type="password" required />
            </div>
          </ActionForm>
        </div>
      )}

      <form className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-end">
        <input type="hidden" name="f" value={f} />
        <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={q} placeholder="ID, name, mobile, email or PAN" className="input" /></div>
        <div><label className="label" htmlFor="by">Date of</label><select id="by" name="by" defaultValue={by} className="input"><option value="joined">Joining</option><option value="activated">Activation</option></select></div>
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="sort">Sort</label><select id="sort" name="sort" defaultValue={sort} className="input">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <button className="btn btn-primary">Show</button>
      </form>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map(([k, l]) => <Link key={k} href={`/admin/members?${qs({ f: k, p: "1" })}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${f === k ? "bg-brand text-white" : "bg-surface border border-line text-muted hover:text-ink"}`}>{l}</Link>)}
      </div>

      <div className="card overflow-x-auto">
        <table className="grid-table">
          <thead><tr><th>ID</th><th>Name / mobile</th><th>Status</th><th>Joined</th><th>Activated</th><th>Last renewal</th><th>Subscription</th><th>KYC</th><th>Wallet</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="py-8 text-center text-muted">No members match.</td></tr>}
            {rows.map((r) => {
              const left = days(r.sub_valid_until as string | null);
              return (
                <tr key={r.code as string}>
                  <td className="font-mono"><Link href={`/admin/members/${r.code}`} className="text-brand-ink font-semibold">{r.code as string}</Link>
                    {r.rank ? <span className="block text-[11px] font-sans font-semibold text-amber">{r.rank as string}</span> : null}</td>
                  <td><Link href={`/admin/members/${r.code}`} className="font-medium hover:text-brand-ink">{r.name as string}</Link><span className="block text-xs text-muted font-mono">{r.mobile as string}</span>
                    {r.sponsor_code ? <span className="block text-[11px] text-ink">Sponsor <Link href={`/admin/members/${r.sponsor_code as string}`} className="font-semibold hover:underline">{(r.sponsor_username as string | null) || (r.sponsor_code as string)}</Link></span> : null}</td>
                  <td><IdBadge status={r.status as string} />{r.green_kind === "complimentary" && <span className="block text-[11px] text-faint">complimentary</span>}
                    {r.blocked ? <span className="block text-[11px] font-bold text-red">Blocked</span> : null}{r.income_hold ? <span className="block text-[11px] font-bold text-amber">Hold</span> : null}</td>
                  <td className="whitespace-nowrap">{dateFmt(r.created_at as string)}</td>
                  <td className="whitespace-nowrap">{dateFmt(r.green_date as string)}</td>
                  <td className="whitespace-nowrap">{dateFmt(r.last_renewal as string)}</td>
                  <td className="whitespace-nowrap">{r.sub_valid_until ? <>{dateFmt(r.sub_valid_until as string)}
                    <span className={`block text-[11px] font-semibold ${left! < 0 ? "text-red" : left! <= 7 ? "text-amber" : "text-green"}`}>{left! < 0 ? `lapsed ${-left!} d` : `${left} days left`}</span></> : "—"}</td>
                  <td className="capitalize">{(r.kyc as string) ?? <span className="text-faint">none</span>}</td>
                  <td className="num">{inr(n(r.wallet))}</td>
                  <td className="whitespace-nowrap text-xs">{r.last_login_at ? dateFmt(r.last_login_at as string) : <span className="text-faint">never</span>}</td>
                  <td>{can(a, "members") && <form action={loginAsAction}><input type="hidden" name="member" value={n(r.id)} />
                    <button title="Open this member's panel" className="btn btn-ghost px-2.5 py-1.5 text-xs"><LogIn className="h-3.5 w-3.5" />Login</button></form>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > 50 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && <Link className="btn btn-ghost" href={`/admin/members?${qs({ p: String(page - 1) })}`}>Previous</Link>}
          <span className="text-muted">Page {page} of {Math.ceil(total / 50)}</span>
          {page * 50 < total && <Link className="btn btn-ghost" href={`/admin/members?${qs({ p: String(page + 1) })}`}>Next</Link>}
        </div>
      )}
    </div>
  );
}
