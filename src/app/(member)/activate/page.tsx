import QRCode from "qrcode";
import { CheckCircle2, Landmark, Smartphone } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { n } from "@/server/db";
import { company, flags, memberProfile, planNow } from "@/server/queries";
import { bp } from "@/server/engine/matching";
import { istDate } from "@/server/engine/dates";
import { razorpayReady } from "@/server/razorpay";
import { paymentRequestAction } from "@/app/actions/member";
import { ActionForm, Field } from "@/components/forms";
import { InfoTip } from "@/components/info-tip";
import { PayButton } from "@/components/pay-button";
import { IdBadge, Notice, PageHead } from "@/components/ui";
import { UploadField } from "@/components/upload";
import { withBase } from "@/lib/base";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Activate" };

const METHOD: Record<string, string> = { upi: "UPI", bank: "Bank transfer", cash: "Cash", cheque: "Cheque" };
const STATUS: Record<string, [string, string]> = {
  pending: ["Waiting for approval", "bg-amber-soft text-amber"], approved: ["Approved", "bg-green-soft text-green"], rejected: ["Rejected", "bg-red-soft text-red"],
};

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const me = await requireMember();
  const { for: forCode } = await searchParams;
  const [plan, p, f, c] = await Promise.all([planNow(), memberProfile(me.id), flags(), company()]);
  const gst = bp(plan.subscriptionBasePaise, plan.gstBp);
  const total = plan.subscriptionBasePaise + gst;
  const green = me.status === "green";
  const gatewayReady = f["feature.online_payment"] && razorpayReady();
  const target = (forCode || me.code).toUpperCase();
  const upi = c.upi_id ? `upi://pay?pa=${encodeURIComponent(c.upi_id)}&pn=${encodeURIComponent(c.bank_account_name || c.legal_name || "Shubhora")}&cu=INR&tn=${encodeURIComponent(`${target} subscription`)}` : null;
  const qr = upi ? await QRCode.toDataURL(upi, { margin: 1, width: 360, color: { dark: "#12144a", light: "#ffffff" } }) : null;
  const requests = await (await db()).query<Record<string, unknown>>(
    `select r.*, r.paid_on::text as paid, r.created_at::text as sent, coalesce(m.username, m.code) as code, p.invoice_no
     from payment_requests r join members m on m.id = r.member_id left join payments p on p.id = r.payment_id
     where r.submitted_by = $1 or r.member_id = $1 order by r.id desc limit 20`, [me.id]);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHead title={green ? "Renew subscription" : "Activate your ID"} sub="Shubhora Business Suite, one month." />

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6 items-start">
        <div className="card p-6">
          <div className="flex items-center justify-between"><p className="font-bold">{me.handle}</p><IdBadge status={me.status} /></div>
          {green && <p className="mt-2 text-sm text-muted">Valid till <b className="text-ink">{dateFmt(p?.sub_valid_until as string)}</b>. A renewal adds one month after that date, so paying early loses nothing.</p>}
          <div className="mt-5 space-y-2 text-sm num">
            <Row k="Subscription" v={inr(plan.subscriptionBasePaise)} />
            <Row k={`GST ${plan.gstBp / 100}%`} v={inr(gst)} />
            <div className="border-t border-line pt-2"><Row k="Total to pay" v={inr(total)} bold /></div>
          </div>
          <ul className="mt-5 space-y-2 text-sm text-muted">
            {["Full Shubhora Business Suite for one month", "GST invoice in your name", green ? "Keeps your renewal income active" : "Turns your ID green so you start earning"].map((x) =>
              <li key={x} className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-green shrink-0 mt-0.5" />{x}</li>)}
          </ul>
          {gatewayReady && (
            <div className="mt-6">
              <p className="text-sm font-bold mb-2">Pay online (instant)</p>
              <PayButton kind={green ? "renewal" : "activation"} label={`Pay ${inr(total)} online`} />
              <p className="mt-2 text-xs text-faint">Or pay by UPI / bank and send the proof.</p>
            </div>
          )}
        </div>

        <div className="card p-6">
          <p className="font-bold flex items-center gap-2">Pay by UPI or bank transfer
            <InfoTip title="How manual payment works" align="right">1. Pay {inr(total)} to the company account shown here. 2. Fill the form with the UTR / transaction number and a screenshot. 3. The company checks the payment and activates or renews the ID, usually the same day. You get a GST invoice either way.</InfoTip>
          </p>
          {c.upi_id || c.bank_account_no ? (
            <div className="mt-4 grid sm:grid-cols-[auto_1fr] gap-4 items-start">
              {qr && (
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="UPI QR code" className="h-40 w-40 rounded-xl border border-line bg-white p-1.5" />
                  <p className="mt-1 text-[11px] text-muted">Scan with any UPI app<br />and enter <b className="text-ink">{inr(total)}</b></p>
                </div>
              )}
              <div className="space-y-2 text-sm">
                {c.upi_id && <p className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-brand" />UPI: <b className="font-mono select-all">{c.upi_id}</b></p>}
                {c.bank_account_no && <div className="rounded-xl bg-surface2 p-3 space-y-0.5">
                  <p className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-brand" />Bank transfer</p>
                  <p>{c.bank_account_name}</p>
                  <p className="font-mono select-all">A/c {c.bank_account_no}</p>
                  <p className="font-mono select-all">IFSC {c.bank_ifsc}</p>
                  {c.bank_name && <p className="text-muted">{c.bank_name}</p>}
                </div>}
                <p className="text-xs text-faint">Write <b className="font-mono">{target}</b> in the payment remark.</p>
                {upi && <a href={upi} className="btn btn-ghost w-full sm:hidden">Open UPI app</a>}
              </div>
            </div>
          ) : <div className="mt-4"><Notice tone="amber">The company has not added its bank or UPI details yet. Ask your sponsor or support for the account, pay, then send the proof here.</Notice></div>}

          <div className="mt-6 border-t border-line pt-5">
            <p className="text-sm font-bold mb-3">After paying, send the proof</p>
            <ActionForm action={paymentRequestAction} submit="Send payment details">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="for_code">For ID <InfoTip title="Paying for someone">Leave your own ID to activate or renew yourself. You can also pay for a person in your team: type their ID.</InfoTip></label>
                  <input id="for_code" name="for_code" defaultValue={target} className="input font-mono uppercase" />
                </div>
                <div><label className="label" htmlFor="method">Paid by</label>
                  <select id="method" name="method" className="input">{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <Field label="UTR / transaction number" name="reference" required placeholder="e.g. 426318975544" hint="12 digits for UPI; from your bank for NEFT / IMPS" />
                <Field label="Amount paid (₹)" name="amount" inputMode="numeric" required defaultValue={String(total / 100)} />
                <div><label className="label" htmlFor="paid_on">Date paid</label><input id="paid_on" type="date" name="paid_on" max={istDate()} defaultValue={istDate()} className="input" required /></div>
                <Field label="Note (optional)" name="note" />
              </div>
              <UploadField name="file" kind="payment" label="Screenshot of the payment" accept="image/*,application/pdf" hint="A photo or screenshot showing the amount and UTR. Reduced automatically." />
            </ActionForm>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <p className="font-bold p-4 pb-2">My payment requests</p>
        <table className="grid-table">
          <thead><tr><th>Sent</th><th>For ID</th><th>Paid by</th><th>UTR</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {requests.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">No manual payments sent yet.</td></tr>}
            {requests.map((r) => {
              const [label, cls] = STATUS[r.status as string];
              return (
                <tr key={String(r.id)}>
                  <td className="whitespace-nowrap">{dateFmt(r.sent as string)}<span className="block text-xs text-faint">paid {dateFmt(r.paid as string)}</span></td>
                  <td className="font-mono">{r.code as string}<span className="block text-xs font-sans text-faint capitalize">{r.kind as string}</span></td>
                  <td>{METHOD[r.method as string]}</td>
                  <td className="font-mono text-xs">{r.reference as string}{r.file_id ? <a href={withBase(`/files/${r.file_id}`)} target="_blank" rel="noreferrer" className="block font-sans text-brand-ink">Screenshot</a> : null}</td>
                  <td className="num">{inr(n(r.amount_paise))}</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>
                    {r.reject_reason ? <span className="block text-xs text-red mt-1">{r.reject_reason as string}</span> : null}
                    {r.invoice_no ? <span className="block text-xs text-faint mt-1">Invoice {r.invoice_no as string}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "font-bold text-base" : "text-muted"}`}><span>{k}</span><span className={bold ? "" : "text-ink"}>{v}</span></div>;
}
