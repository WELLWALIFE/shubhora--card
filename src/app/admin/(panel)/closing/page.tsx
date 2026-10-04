import Link from "next/link";
import { db } from "@/server";
import { maybeOne } from "@/server/db";
import { can, requireAdmin } from "@/server/auth/session";
import { addDays, istDate } from "@/server/engine/dates";
import { runClosing, type ClosingSummary } from "@/server/engine/closing";
import { RuleError } from "@/server/engine/members";
import { closingAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { Notice, PageHead } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Daily closing" };

export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const a = await requireAdmin();
  const d = await db();
  const last = await maybeOne<{ d: string | null }>(d, "select max(closing_date)::text as d from closings");
  const today = istDate();
  const first = await maybeOne<{ d: string | null }>(d, "select min(event_date)::text as d from bv_events where closing_id is null and not void");
  const next = last?.d ? addDays(last.d, 1) : (first?.d ?? addDays(today, -1));
  const due = next < today;
  const { preview } = await searchParams;

  let pv: ClosingSummary | null = null;
  let pvError: string | null = null;
  if (preview && due) {
    try { pv = (await runClosing(d, next, { preview: true })).summary; }
    catch (e) { if (e instanceof RuleError) pvError = e.message; else throw e; }
  }
  const history = await d.query<{ closing_date: string; summary: ClosingSummary; posted_at: string }>(
    "select closing_date::text, summary, posted_at::text from closings order by closing_date desc limit 60");

  return (
    <div className="space-y-6">
      <PageHead title="Daily closing" sub="Closings run in date order. Each day can be closed only once, after it ends. The nightly job runs this automatically at midnight." />
      <div className="card p-5">
        {due ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="font-bold">Next closing: {dateFmt(next)}</p><p className="text-sm text-muted">Preview first. Nothing is posted until you confirm.</p></div>
            <Link href={`/admin/closing?preview=${next}`} className="btn btn-ghost">Preview {dateFmt(next)}</Link>
          </div>
        ) : <Notice tone="green">All closings are up to date. The next one ({dateFmt(next)}) can run after midnight.</Notice>}
        {pvError && <div className="mt-4"><Notice tone="red">{pvError}</Notice></div>}
        {pv && (
          <div className="mt-5 space-y-4">
            <Summary s={pv} />
            {can(a, "money") && (
              <ActionForm action={closingAction} submit={`Post closing for ${dateFmt(next)}`} className="max-w-sm">
                <input type="hidden" name="date" value={next} />
              </ActionForm>
            )}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="grid-table num">
          <thead><tr><th>Date</th><th>Joinings / renewals</th><th>Pairs new</th><th>Pairs renewal</th><th>Flushed</th><th>Direct</th><th>Matching</th><th>Sponsor</th><th>Rank rewards</th><th>TDS</th><th>Credited</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={11} className="py-8 text-center text-muted">No closings yet.</td></tr>}
            {history.map((h) => {
              const s = typeof h.summary === "string" ? JSON.parse(h.summary) as ClosingSummary : h.summary;
              return (
                <tr key={h.closing_date}>
                  <td className="whitespace-nowrap font-semibold">{dateFmt(h.closing_date)}</td><td>{s.events}</td>
                  <td>{s.paidPairs.new}/{s.pairs.new}</td><td>{s.paidPairs.renewal}/{s.pairs.renewal}</td><td>{s.flushedPairs.new + s.flushedPairs.renewal}</td>
                  <td>{inr(s.income.direct)}</td><td>{inr(s.income.match_new + s.income.match_renewal)}</td><td>{inr(s.income.sponsor)}</td><td>{inr(s.income.rank_reward ?? 0)}</td>
                  <td>{inr(s.tds)}</td><td className="font-semibold">{inr(s.credited)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ s }: { s: ClosingSummary }) {
  const items: [string, string][] = [
    ["BV entries", String(s.events)], ["Members with volume", String(s.members)],
    ["Pairs paid / made (new)", `${s.paidPairs.new} / ${s.pairs.new}`], ["Pairs paid / made (renewal)", `${s.paidPairs.renewal} / ${s.pairs.renewal}`],
    ["Direct Sale Bonus", inr(s.income.direct)], ["Matching (new)", inr(s.income.match_new)], ["Matching (renewal)", inr(s.income.match_renewal)],
    ["Sponsor Bonus", inr(s.income.sponsor)], ["Rank rewards", inr(s.income.rank_reward ?? 0)],
    ["Ranks achieved", String(s.ranks?.achieved ?? 0)], ["Reward payments waiting for pool", String(s.ranks?.deferred ?? 0)],
    ["Held (not credited)", inr(s.held)], ["Grace income held / released / lost", s.grace ? `${inr(s.grace.held)} / ${inr(s.grace.released)} / ${inr(s.grace.forfeited)}` : "—"],
    ["Turnover (before GST)", s.turnover !== undefined ? inr(s.turnover) : "—"], ["Payout as % of turnover", s.payoutPct !== undefined ? `${s.payoutPct}%` : "—"],
    ["TDS", inr(s.tds)], ["Admin charge", inr(s.adminCharge)],
    ["Net credited to wallets", inr(s.credited)],
  ];
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(([k, v]) => <div key={k} className="rounded-xl bg-surface2 p-3"><p className="text-xs text-muted">{k}</p><p className="mt-1 font-bold num">{v}</p></div>)}
    </div>
  );
}
