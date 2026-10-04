import { notFound } from "next/navigation";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { getAdmin, getMember } from "@/server/auth/session";
import { PrintButton } from "@/components/print-button";
import { company } from "@/server/queries";
import { dateFmt, inr } from "@/lib/format";
import { GST_STATES, gstSplit, rupeesInWords } from "@/lib/gst";

export const metadata = { title: "Invoice" };



export default async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await company();
  const COMPANY = { name: c.legal_name || "Wellwa Life India Pvt Ltd", address: c.address || "", gstin: c.gstin || "", state: c.state_code || c.gstin?.slice(0, 2) || "", sac: c.sac || "998314" };
  const [admin, member] = await Promise.all([getAdmin(), getMember()]);
  const p = await maybeOne<Record<string, unknown>>(await db(),
    `select p.*, p.business_date::text as day, p.period_from::text as pf, p.period_to::text as pt,
            m.code, m.name, m.mobile, m.email, k.gstin, k.address
     from payments p join members m on m.id = p.member_id left join kyc k on k.member_id = m.id where p.id = $1`, [Number(id)]);
  if (!p || !p.invoice_no) notFound();
  if (!admin && member?.id !== n(p.member_id)) notFound();
  const gst = n(p.gst_paise);
  const buyerState = String(p.gstin ?? "").slice(0, 2);
  const { intra, pos: supply, cgst, sgst } = gstSplit(gst, COMPANY.state, p.gstin as string | null);   // B2C: supplier's state
  const taxInvoice = !!COMPANY.gstin;

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10 bg-white text-[#12144a] min-h-screen print:p-0">
      <div className="flex justify-between items-start">
        <div><p className="text-2xl font-extrabold">{taxInvoice ? "Tax Invoice" : "Payment receipt"}</p><p className="mt-1 font-mono text-sm">{p.invoice_no as string}</p><p className="text-sm">Date {dateFmt(p.day as string)}</p></div>
        <PrintButton />
      </div>
      <div className="mt-8 grid sm:grid-cols-2 gap-6 text-sm">
        <div><p className="font-bold">{COMPANY.name}</p><p className="whitespace-pre-line">{COMPANY.address}</p>{COMPANY.gstin ? <p>GSTIN {COMPANY.gstin}</p> : admin ? <p className="text-[#d63b31] print:hidden">GSTIN not set (Admin → Company details). Until it is set this prints as a payment receipt.</p> : null}{c.pan ? <p>PAN {c.pan}</p> : null}</div>
        <div><p className="text-xs uppercase tracking-wide text-[#5a5f86]">Billed to</p><p className="font-bold">{p.name as string} ({p.code as string})</p><p>{(p.address as string) ?? ""}</p><p>{p.mobile as string}{p.email ? ` · ${p.email as string}` : ""}</p>{p.gstin ? <p>GSTIN {p.gstin as string}</p> : null}
          {supply ? <p className="mt-2 text-xs text-[#5a5f86]">Place of supply: {GST_STATES[supply] ?? supply} ({supply})</p> : null}</div>
      </div>
      <table className="mt-8 w-full text-sm border-collapse">
        <thead><tr className="border-b-2 border-[#12144a] text-left"><th className="py-2">Description</th><th>SAC</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          <tr className="border-b"><td className="py-3">Shubhora Business Suite subscription ({p.kind === "renewal" ? "renewal" : "new"})<br /><span className="text-xs text-[#5a5f86]">Period {dateFmt(p.pf as string)} to {dateFmt(p.pt as string)}</span></td><td>{COMPANY.sac}</td><td className="text-right">{inr(n(p.base_paise), { decimals: true })}</td></tr>
          {intra ? (<>
            <tr><td className="py-1" colSpan={2}>CGST 9%</td><td className="text-right">{inr(cgst, { decimals: true })}</td></tr>
            <tr><td className="py-1" colSpan={2}>SGST 9%</td><td className="text-right">{inr(sgst, { decimals: true })}</td></tr>
          </>) : <tr><td className="py-1" colSpan={2}>IGST 18%</td><td className="text-right">{inr(gst, { decimals: true })}</td></tr>}
          <tr className="border-t-2 border-[#12144a] font-bold"><td className="py-2" colSpan={2}>Total</td><td className="text-right">{inr(n(p.total_paise), { decimals: true })}</td></tr>
        </tbody>
      </table>
      <p className="mt-3 text-sm"><span className="text-[#5a5f86]">Amount in words:</span> <b>{rupeesInWords(n(p.total_paise))}</b></p>
      <p className="mt-1 text-xs text-[#5a5f86]">Payment: {String(p.method).charAt(0).toUpperCase() + String(p.method).slice(1)}{p.reference ? ` · Ref ${p.reference as string}` : ""} · Tax payable on reverse charge: No</p>
      {p.status === "refunded" && (
        <div className="mt-8 rounded-lg border-2 border-[#d63b31] p-4 text-sm">
          <p className="font-bold text-[#d63b31]">Credit note {(p.credit_note_no as string) ?? ""}</p>
          <p className="mt-1">Issued against invoice {p.invoice_no as string} on {dateFmt(p.refunded_at as string)} for the full amount of {inr(n(p.total_paise), { decimals: true })} (taxable value {inr(n(p.base_paise), { decimals: true })}, GST {inr(gst, { decimals: true })}).</p>
          <p className="mt-1 text-[#5a5f86]">Reason: {p.refund_reason as string}</p>
        </div>
      )}
      <p className="mt-10 text-xs text-[#5a5f86]">This is a computer-generated {taxInvoice ? "invoice" : "receipt"} and does not need a signature.{c.support_email ? ` Questions: ${c.support_email}` : ""}</p>
    </div>
  );
}
