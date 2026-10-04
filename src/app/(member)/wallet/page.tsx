import Link from "next/link";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { flags, planNow } from "@/server/queries";
import { available } from "@/server/engine/wallet";
import { withdrawAction } from "@/app/actions/member";
import { ActionForm, Field } from "@/components/forms";
import { Notice, PageHead, Stat } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";
import { withBase } from "@/lib/base";
import { dateFmt, INCOME_LABEL, inr, LEDGER_LABEL } from "@/lib/format";

export const metadata = { title: "Wallet" };

export default async function WalletPage() {
  const me = await requireMember();
  const d = await db();
  const [f, plan, prof, kyc] = await Promise.all([
    flags(), planNow(),
    maybeOne<{ show_balance: boolean; withdraw_block: boolean }>(d, "select show_balance, withdraw_block from members where id = $1", [me.id]),
    maybeOne<{ status: string }>(d, "select status from kyc where member_id = $1", [me.id]),
  ]);
  const bal = await available(d, me.id);
  const totals = await d.query<{ entry: string; s: unknown }>(
    "select entry, sum(amount_paise) as s from ledger where member_id = $1 group by entry", [me.id]);
  const t = (e: string) => n(totals.find((x) => x.entry === e)?.s);
  const ledger = await d.query<Record<string, unknown>>(
    `select l.entry, l.amount_paise, l.note, l.created_at::text, i.kind, c.closing_date::text as cd, s.code as src
     from ledger l left join incomes i on i.id = l.income_id
     left join closings c on c.id = coalesce(l.closing_id, i.closing_id)
     left join members s on s.id = i.source_member_id
     where l.member_id = $1 order by l.id desc limit 200`, [me.id]);
  const noteOf = (l: Record<string, unknown>) => [
    l.kind ? INCOME_LABEL[l.kind as string] : null,
    l.src ? `from ${l.src as string}` : null,
    l.cd ? `closing ${dateFmt(l.cd as string)}` : null,
    (l.note as string) || null,
  ].filter(Boolean).join(" · ");
  const wds = await d.query<Record<string, unknown>>(
    "select id, amount_paise, status, utr, reject_reason, requested_at::text from withdrawals where member_id = $1 order by id desc limit 50", [me.id]);
  const show = prof?.show_balance;

  return (
    <div className="space-y-6">
      <PageHead title="Wallet" sub="Every rupee in and out of your wallet, with the reason.">
        {show && <a href={withBase("/me/export?type=wallet")} className="btn btn-ghost">Download (Excel)</a>}
        <InfoTip title="How the wallet works" align="right">Income is added after each night&apos;s closing, with TDS already deducted. When you ask for a withdrawal the amount is kept aside, and it leaves the wallet when the company pays it to your bank; you then see the bank reference (UTR). You need approved KYC to withdraw.</InfoTip>
      </PageHead>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Available" value={show ? inr(bal) : "Hidden"} tone="green" />
        <Stat label="Total income" value={show ? inr(t("income")) : "Hidden"} />
        <Stat label="TDS deducted" value={show ? inr(-t("tds")) : "Hidden"} />
        <Stat label="Withdrawn" value={show ? inr(-t("withdrawal")) : "Hidden"} />
      </div>

      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="card overflow-x-auto order-2 xl:order-1">
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Entry</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {ledger.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">No wallet entries yet.</td></tr>}
              {ledger.map((l, i) => {
                const a = n(l.amount_paise);
                return (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{dateFmt(l.created_at as string)}</td>
                    <td>{LEDGER_LABEL[l.entry as string]}</td>
                    <td className="text-muted text-xs">{noteOf(l)}</td>
                    <td className={`text-right font-semibold num ${a < 0 ? "text-red" : "text-green"}`}>{show ? `${a < 0 ? "−" : "+"}${inr(Math.abs(a))}` : "••••"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-4 order-1 xl:order-2">
          <div className="card p-5">
            <p className="font-bold">Withdraw</p>
            {!f["feature.withdrawals"] ? <p className="mt-2 text-sm text-muted">Withdrawals are paused right now.</p>
              : prof?.withdraw_block ? <p className="mt-2 text-sm text-muted">Withdrawals are on hold for this ID. Contact support.</p>
              : kyc?.status !== "approved" ? <div className="mt-3"><Notice tone="amber">Complete your KYC first. <Link href="/kyc" className="underline font-semibold">Go to KYC</Link></Notice></div>
              : (
                <div className="mt-3">
                  <ActionForm action={withdrawAction} submit="Request withdrawal">
                    <Field label="Amount in rupees" name="amount" inputMode="numeric" required hint={`Minimum ${inr(plan.minWithdrawalPaise)}. Paid to your KYC bank account.`} />
                  </ActionForm>
                </div>
              )}
          </div>
          <div className="card p-5">
            <p className="font-bold">Requests</p>
            {wds.length === 0 ? <p className="mt-2 text-sm text-muted">No withdrawal requests yet.</p> : (
              <ul className="mt-3 space-y-3">
                {wds.map((w) => (
                  <li key={String(w.id)} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="font-semibold num">{inr(n(w.amount_paise))}</p>
                      <p className="text-xs text-faint">{dateFmt(w.requested_at as string)}{w.utr ? ` · UTR ${w.utr}` : ""}</p>
                      {w.reject_reason ? <p className="text-xs text-red">{w.reject_reason as string}</p> : null}
                    </div>
                    <StatusChip s={w.status as string} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ s }: { s: string }) {
  const cls = { requested: "bg-brand-soft text-brand-ink", approved: "bg-amber-soft text-amber", paid: "bg-green-soft text-green", rejected: "bg-red-soft text-red" }[s];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${cls}`}>{s}</span>;
}
