import Link from "next/link";
import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { kycDecisionAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "KYC" };

export default async function KycAdmin({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireAdmin("kyc");
  const { s = "pending" } = await searchParams;
  const rows = await (await db()).query<Record<string, unknown>>(
    `select k.*, k.submitted_at::text as sub, m.code, m.name from kyc k join members m on m.id = k.member_id
     where k.status = $1 order by k.submitted_at desc, k.member_id desc limit 200`, [s]);
  return (
    <div className="space-y-5">
      <PageHead title="KYC review" sub="Check that the PAN name and the bank account name belong to the same person." />
      <div className="flex gap-1">{["pending", "approved", "rejected"].map((k) =>
        <Link key={k} href={`/admin/kyc?s=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${s === k ? "bg-brand text-white" : "bg-surface border border-line text-muted"}`}>{k}</Link>)}</div>
      <div className="grid lg:grid-cols-2 gap-4">
        {rows.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
        {rows.map((k) => {
          const mismatch = String(k.pan_name ?? "").trim().toLowerCase() !== String(k.account_name ?? "").trim().toLowerCase();
          return (
            <div key={k.code as string} className="card p-5 text-sm">
              <div className="flex justify-between"><Link href={`/admin/members/${k.code}`} className="font-bold">{k.name as string} · <span className="font-mono text-brand-ink">{k.code as string}</span></Link><span className="text-faint">{dateFmt(k.sub as string)}</span></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                <dt className="text-muted">PAN</dt><dd className="font-mono">{k.pan as string}</dd>
                <dt className="text-muted">Name on PAN</dt><dd>{k.pan_name as string}</dd>
                <dt className="text-muted">Account name</dt><dd className={mismatch ? "text-red font-semibold" : ""}>{k.account_name as string}</dd>
                <dt className="text-muted">Bank</dt><dd>{k.bank_name as string}</dd>
                <dt className="text-muted">Account / IFSC</dt><dd className="font-mono">{k.account_no as string} · {k.ifsc as string}</dd>
                <dt className="text-muted">Aadhaar</dt><dd>{k.aadhaar_last4 ? `XXXX XXXX ${k.aadhaar_last4}` : "—"}</dd>
                <dt className="text-muted">GSTIN</dt><dd>{(k.gstin as string) || "—"}</dd>
              </dl>
              {mismatch && <p className="mt-2 text-xs font-semibold text-red">Names do not match exactly. Check before approving.</p>}
              <div className="mt-3 grid grid-cols-4 gap-2">
                {([["pan_file", "PAN"], ["bank_file", "Cheque"], ["aadhaar_front_file", "Aadhaar F"], ["aadhaar_back_file", "Aadhaar B"]] as const).map(([f, l]) => k[f]
                  ? <a key={f} href={withBase(`/files/${k[f]}`)} target="_blank" rel="noreferrer" className="block text-center text-[11px] text-brand-ink">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={withBase(`/files/${k[f]}`)} alt={l} className="h-16 w-full rounded-lg object-cover bg-surface2" />{l}</a>
                  : <span key={f} className="grid h-16 place-items-center rounded-lg bg-surface2 text-[11px] text-faint">No {l}</span>)}
              </div>
              {s === "pending" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionForm action={kycDecisionAction} submit="Approve" className="[&>button]:w-auto [&>button]:bg-green"><input type="hidden" name="member" value={String(k.member_id)} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                  <ActionForm action={kycDecisionAction} submit="Reject" danger className="flex flex-wrap items-start gap-2 [&>button]:w-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap [&>p]:basis-full"><input type="hidden" name="member" value={String(k.member_id)} /><input type="hidden" name="decision" value="reject" /><input name="reason" placeholder="Reason for member" required className="input w-48" /></ActionForm>
                </div>
              )}
              {k.reject_reason ? <p className="mt-2 text-xs text-red">{k.reject_reason as string}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
