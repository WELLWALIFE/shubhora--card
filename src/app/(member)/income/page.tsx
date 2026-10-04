import Link from "next/link";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { n } from "@/server/db";
import { incomeTotals } from "@/server/queries";
import { PageHead, Stat } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";
import { withBase } from "@/lib/base";
import { bvFmt, dateFmt, INCOME_LABEL, inr } from "@/lib/format";

export const metadata = { title: "Income" };

const TABS = [["all", "All income"], ["direct", "Direct Sale Bonus"], ["match_new", "Matching · New"], ["match_renewal", "Matching · Renewal"], ["sponsor", "Sponsor Bonus"], ["rank_reward", "Rank rewards"], ["closings", "Pair details"]] as const;

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const me = await requireMember();
  const { t = "all" } = await searchParams;
  const d = await db();
  const totals = await incomeTotals(me.id);

  const incomes = t === "closings" ? [] : await d.query<Record<string, unknown>>(
    `select i.kind, i.gross_paise, i.held, c.closing_date::text as day, s.code as src_code, s.name as src_name
     from incomes i join closings c on c.id = i.closing_id left join members s on s.id = i.source_member_id
     where i.member_id = $1 and ($2 = 'all' or i.kind = $2) order by c.closing_date desc, i.id desc limit 300`, [me.id, t]);
  const lines = t !== "closings" ? [] : await d.query<Record<string, unknown>>(
    `select l.*, c.closing_date::text as day from closing_lines l join closings c on c.id = l.closing_id
     where l.member_id = $1 order by c.closing_date desc, l.bin limit 300`, [me.id]);

  return (
    <div className="space-y-6">
      <PageHead title="Income" sub="Worked out at the daily closing. Amounts before TDS.">
        <a href={withBase("/me/export?type=income")} className="btn btn-ghost">Download (Excel)</a>
        <InfoTip title="How you earn" align="right">Matching Bonus in two binaries (new sales and renewals): ₹500 for every 1:1 pair, up to 10 pairs (₹5,000) a day in each. Renewal income needs your own subscription active; in the grace days after it ends, it is held and paid only if you renew in time. Every direct sale also gives you Shubhora AI credits in your Suite account. Rank reward: paid when you reach a rank. Pair details shows how every pair was counted.</InfoTip>
      </PageHead>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {(["direct", "match_new", "match_renewal", "sponsor", "rank_reward"] as const).map((k) => <Stat key={k} label={INCOME_LABEL[k]} value={inr(totals[k].total)} />)}
      </div>
      <div className="flex flex-wrap gap-1">
        {TABS.map(([k, l]) => <Link key={k} href={`/income?t=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${t === k ? "bg-brand text-white" : "bg-surface border border-line text-muted hover:text-ink"}`}>{l}</Link>)}
      </div>
      <div className="card overflow-x-auto">
        {t === "closings" ? (
          <table className="grid-table num">
            <thead><tr><th>Date</th><th>Binary</th><th>Opening L / R</th><th>New L / R</th><th>Pairs</th><th>Paid</th><th>Flushed</th><th>Carry L / R</th><th>Amount</th><th>Note</th></tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-muted">No closings for your ID yet.</td></tr>}
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{dateFmt(l.day as string)}</td><td>{l.bin === "new" ? "New sale" : "Renewal"}</td>
                  <td>{bvFmt(n(l.open_left))} / {bvFmt(n(l.open_right))}</td><td>{bvFmt(n(l.in_left))} / {bvFmt(n(l.in_right))}</td>
                  <td>{n(l.pairs)}</td><td className="text-green font-semibold">{n(l.paid_pairs)}</td><td className="text-red">{n(l.flushed_pairs)}</td>
                  <td>{bvFmt(n(l.close_left))} / {bvFmt(n(l.close_right))}</td><td className="font-semibold">{inr(n(l.amount_paise))}</td>
                  <td className="text-muted">{reasonText(l.reason as string | null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="grid-table">
            <thead><tr><th>Date</th><th>Income</th><th>From</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {incomes.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">No income yet.</td></tr>}
              {incomes.map((r, i) => (
                <tr key={i}>
                  <td>{dateFmt(r.day as string)}</td>
                  <td>{INCOME_LABEL[r.kind as string]}{r.held ? <span className="ml-2 rounded bg-amber-soft px-1.5 py-0.5 text-[11px] font-bold text-amber">On hold</span> : null}</td>
                  <td className="text-muted">{r.src_code ? `${r.src_name} · ${r.src_code}` : "Your team"}</td>
                  <td className="text-right font-semibold num">{inr(n(r.gross_paise))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function reasonText(r: string | null) {
  if (!r) return "";
  return ({ red: "ID was red", "daily cap": "Above daily cap", blocked: "ID blocked", complimentary: "Complimentary ID",
    "own subscription not active": "Own subscription not active", "subscription lapsed too long": "Subscription lapsed too long" } as Record<string, string>)[r] ?? r;
}
