import Link from "next/link";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { n } from "@/server/db";
import { memberProfile } from "@/server/queries";
import { memberPasswordAction, photoAction, profileAction } from "@/app/actions/member";
import { UploadField } from "@/components/upload";
import { maybeOne } from "@/server/db";
import { ActionForm, Field } from "@/components/forms";
import { IdBadge, Notice, PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Profile" };

export default async function Profile({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const me = await requireMember();
  const { need } = await searchParams;
  const d = await db();
  const p = await memberProfile(me.id);
  const photo = (await maybeOne<{ photo_file: string | null }>(d, "select photo_file from members where id = $1", [me.id]))?.photo_file ?? null;
  const invoices = await d.query<Record<string, unknown>>(
    "select id, invoice_no, kind, total_paise, business_date::text as day, status from payments where member_id = $1 and invoice_no is not null order by id desc", [me.id]);
  const tds = await d.query<Record<string, unknown>>(
    `select fy, sum(amount_paise) filter (where entry = 'income') as gross, -sum(amount_paise) filter (where entry = 'tds') as tds
     from ledger where member_id = $1 group by fy order by fy desc`, [me.id]);

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHead title="Profile" />
      {need === "email" && <Notice tone="amber">Add your email below. Your Shubhora Business Suite login is created on it, and then the Open Shubhora button works.</Notice>}
      <div className="card p-6 grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <Row k="Username" v={<span className="font-semibold">{me.handle}</span>} />
        <Row k="Account no. (for support)" v={<span className="font-mono text-muted">{me.code}</span>} />
        {(p?.dob || p?.gender) ? <Row k="Date of birth · Gender" v={`${p?.dob ? dateFmt(String(p.dob)) : "—"} · ${p?.gender ? String(p.gender)[0].toUpperCase() + String(p.gender).slice(1) : "—"}`} /> : null}
        <Row k="Status" v={<IdBadge status={me.status} />} />
        <Row k="Name" v={p?.name as string} />
        <Row k="Mobile" v={p?.mobile as string} />
        <Row k="Sponsor" v={p?.sponsor_code ? `${p.sponsor_name} · ${p.sponsor_code}` : "—"} />
        <Row k="Placed under" v={p?.parent_code ? `${p.parent_code} · ${p.leg === "L" ? "Left" : "Right"}` : "—"} />
        <Row k="Joined" v={dateFmt(p?.created_at as string)} />
        <Row k="Subscription till" v={dateFmt(p?.sub_valid_until as string)} />
        <p className="sm:col-span-2 mt-2 text-xs text-faint">To change your name or mobile number, raise a support ticket.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-6">
          <p className="font-bold mb-4">Profile photo</p>
          <ActionForm action={photoAction} submit="Save photo">
            <UploadField name="photo" kind="photo" label="Photo (reduced automatically)" current={photo} maxDim={600} />
          </ActionForm>
        </div>
        <div className="card p-6">
          <p className="font-bold mb-4">Documents</p>
          <div className="space-y-2 text-sm">
            <Link href="/welcome-letter" className="btn btn-ghost w-full">Welcome letter (print or save as PDF)</Link>
            <a href={withBase("/me/export?type=income")} className="btn btn-ghost w-full">Income statement (Excel)</a>
            <a href={withBase("/me/export?type=wallet")} className="btn btn-ghost w-full">Wallet statement (Excel)</a>
            <a href={withBase("/me/export?type=team")} className="btn btn-ghost w-full">Team list (Excel)</a>
          </div>
        </div>
        <div className="card p-6">
          <p className="font-bold mb-4">Email and Shubhora login</p>
          {p?.suite_user_id
            ? <p className="text-sm text-muted">Your Shubhora Business Suite login: <b className="text-ink">{p.suite_email as string}</b>. Open it any time with the Open Shubhora button, no password needed.</p>
            : <ActionForm action={profileAction} submit="Save"><Field label="Email" name="email" type="email" required defaultValue={(p?.email as string) ?? ""} hint="Your Shubhora Business Suite login is created on this email." /></ActionForm>}
        </div>
        <div className="card p-6">
          <p className="font-bold mb-4">Change password</p>
          <ActionForm action={memberPasswordAction} submit="Change password">
            <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
            <Field label="New password" name="password" type="password" required autoComplete="new-password" />
            <Field label="Repeat new password" name="password2" type="password" required autoComplete="new-password" />
          </ActionForm>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <p className="font-bold p-4 pb-2">Invoices</p>
        <table className="grid-table">
          <thead><tr><th>Date</th><th>Invoice</th><th>For</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No invoices yet.</td></tr>}
            {invoices.map((x) => (
              <tr key={String(x.id)}>
                <td>{dateFmt(x.day as string)}</td>
                <td><Link href={`/invoice/${x.id}`} target="_blank" className="font-mono text-brand-ink">{x.invoice_no as string}</Link></td>
                <td className="capitalize">{x.kind as string}</td><td className="num">{inr(n(x.total_paise))}</td>
                <td className={x.status === "paid" ? "text-green font-semibold" : "text-red font-semibold"}>{x.status === "paid" ? "Paid" : "Refunded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <p className="font-bold p-4 pb-2">TDS statement</p>
        <table className="grid-table num">
          <thead><tr><th>Financial year</th><th>Commission</th><th>TDS deducted</th><th>Net</th></tr></thead>
          <tbody>
            {tds.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No income yet.</td></tr>}
            {tds.map((t) => <tr key={t.fy as string}><td>{t.fy as string}</td><td>{inr(n(t.gross))}</td><td>{inr(n(t.tds))}</td><td className="font-semibold">{inr(n(t.gross) - n(t.tds))}</td></tr>)}
          </tbody>
        </table>
        <p className="px-4 pb-4 text-xs text-faint">TDS is deposited against your PAN under section 194H and appears in your Form 26AS. The official TDS certificate (Form 16A) is issued by the company every quarter.</p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-line"><span className="text-muted">{k}</span><span className="font-medium text-right">{v}</span></div>;
}
