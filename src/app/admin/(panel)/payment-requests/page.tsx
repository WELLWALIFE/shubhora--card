import Link from "next/link";
import { db } from "@/server";
import { n } from "@/server/db";
import { can, requireAdmin } from "@/server/auth/session";
import { planNow } from "@/server/queries";
import { bp } from "@/server/engine/matching";
import { paymentRequestDecisionAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { InfoTip } from "@/components/info-tip";
import { IdBadge, PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";
import { dateFmt, inr, dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Payment requests" };

const METHOD: Record<string, string> = { upi: "UPI", bank: "Bank transfer", cash: "Cash", cheque: "Cheque" };

export default async function PaymentRequests({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const a = await requireAdmin("reports");
  const { s = "pending" } = await searchParams;
  const plan = await planNow();
  const total = plan.subscriptionBasePaise + bp(plan.subscriptionBasePaise, plan.gstBp);
  const rows = await (await db()).query<Record<string, unknown>>(
    `select r.*, r.paid_on::text as paid, r.created_at::text as sent, r.decided_at::text as decided,
            m.code, m.name, m.mobile, m.status as member_status, m.sub_valid_until::text as till,
            b.code as by_code, ad.username, p.invoice_no
     from payment_requests r join members m on m.id = r.member_id join members b on b.id = r.submitted_by
     left join admins ad on ad.id = r.decided_by left join payments p on p.id = r.payment_id
     where r.status = $1 order by r.id desc limit 300`, [s]);
  const money = can(a, "money");

  return (
    <div className="space-y-5">
      <PageHead title="Payment requests" sub="Manual payments sent by members with UTR and screenshot. Check your bank or UPI app, then approve.">
        <InfoTip title="Before approving" align="right">Open your bank or UPI app and find a credit with this UTR and amount on that date. Approve only if you can see the money. Approving activates or renews the ID for one month, makes the GST invoice and adds BV for the team. A transaction number can be used only once.</InfoTip>
      </PageHead>
      <div className="flex gap-1">{["pending", "approved", "rejected"].map((k) =>
        <Link key={k} href={`/admin/payment-requests?s=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${s === k ? "bg-brand text-white" : "bg-surface border border-line text-muted"}`}>{k}</Link>)}</div>
      {rows.length === 0 && <div className="card p-8 text-center text-sm text-muted">Nothing here.</div>}
      <div className="grid lg:grid-cols-2 gap-4">
        {rows.map((r) => {
          const amount = n(r.amount_paise);
          const short = amount < total;
          return (
            <div key={String(r.id)} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/admin/members/${r.code}?tab=subscription`} className="font-bold hover:text-brand-ink">{r.name as string} · <span className="font-mono text-brand-ink">{r.code as string}</span></Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted"><IdBadge status={r.member_status as string} /><span className="capitalize">{r.kind as string}</span>{r.till ? <span>· valid till {dateFmt(r.till as string)}</span> : null}</div>
                  {r.by_code !== r.code && <p className="mt-1 text-xs text-muted">Sent by upline <span className="font-mono">{r.by_code as string}</span></p>}
                </div>
                <p className={`text-xl font-bold num ${short ? "text-red" : ""}`}>{inr(amount)}</p>
              </div>
              <div className="mt-4 grid grid-cols-[1fr_auto] gap-4">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Paid by</dt><dd>{METHOD[r.method as string]}</dd>
                  <dt className="text-muted">UTR</dt><dd className="font-mono select-all">{r.reference as string}</dd>
                  <dt className="text-muted">Date paid</dt><dd>{dateFmt(r.paid as string)}</dd>
                  <dt className="text-muted">Sent</dt><dd>{dateTimeFmt(r.sent as string, { year: false })}</dd>
                  {r.note ? <><dt className="text-muted">Note</dt><dd>{r.note as string}</dd></> : null}
                  {short && <><dt className="text-red font-semibold">Short by</dt><dd className="text-red font-semibold">{inr(total - amount)}</dd></>}
                </dl>
                {r.file_id ? <a href={withBase(`/files/${r.file_id}`)} target="_blank" rel="noreferrer" className="block w-28 text-center text-xs text-brand-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={withBase(`/files/${r.file_id}`)} alt="Payment screenshot" className="h-32 w-28 rounded-lg object-cover bg-surface2 border border-line" />Open screenshot</a>
                  : <span className="grid h-32 w-28 place-items-center rounded-lg bg-surface2 text-xs text-faint text-center">No screenshot</span>}
              </div>
              {s === "pending" && money && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                  <ActionForm action={paymentRequestDecisionAction} submit={`Approve & ${r.member_status === "green" ? "renew" : "activate"}`} className="[&>button]:w-auto">
                    <input type="hidden" name="request" value={String(r.id)} /><input type="hidden" name="decision" value="approve" />
                  </ActionForm>
                  <ActionForm action={paymentRequestDecisionAction} submit="Reject" danger className="flex flex-wrap gap-2 [&>button]:w-auto">
                    <input type="hidden" name="request" value={String(r.id)} /><input type="hidden" name="decision" value="reject" />
                    <input name="reason" required placeholder="Reason (member sees it)" className="input w-52" />
                  </ActionForm>
                </div>
              )}
              {s !== "pending" && <p className="mt-3 text-xs text-muted">{s === "approved" ? `Approved${r.invoice_no ? ` · invoice ${r.invoice_no}` : ""}` : `Rejected: ${r.reject_reason}`} · by {(r.username as string) ?? "staff"} · {dateFmt(r.decided as string)}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
