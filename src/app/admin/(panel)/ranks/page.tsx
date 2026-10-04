import Link from "next/link";
import { withBase } from "@/lib/base";
import { db } from "@/server";
import { n } from "@/server/db";
import { can, requireAdmin } from "@/server/auth/session";
import { istDate } from "@/server/engine/dates";
import { addMonths, loadRanks } from "@/server/engine/ranks";
import { settingsFor } from "@/server/engine/settings";
import { bp } from "@/server/engine/matching";
import { rankTableAction, rewardDecisionAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { RankBadge } from "@/components/rank-badge";
import { PageHead, Stat } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Ranks" };

export default async function RanksAdmin() {
  const a = await requireAdmin();
  const d = await db();
  const today = istDate();
  const month = `${today.slice(0, 7)}-01`;
  const ranks = await loadRanks(d, false);
  const { s } = await settingsFor(d, today);
  const counts = new Map((await d.query<{ level: unknown; c: unknown }>("select level, count(*) as c from member_ranks group by level")).map((r) => [n(r.level), n(r.c)]));
  const waiting = await d.query<Record<string, unknown>>(
    `select i.member_id, i.level, m.code, m.name, sum(i.amount_paise) as total, count(*) as parts, min(r.achieved_on)::text as achieved
     from reward_instalments i join members m on m.id = i.member_id join member_ranks r on r.member_id = i.member_id and r.level = i.level
     where i.status = 'awaiting_approval' group by i.member_id, i.level, m.code, m.name order by achieved`);
  const recent = await d.query<Record<string, unknown>>(
    `select r.level, r.rank_name, r.achieved_on::text, r.reward_paise, m.code, m.name from member_ranks r join members m on m.id = r.member_id
     order by r.achieved_on desc, r.level desc limit 100`);
  const turnover = n((await d.query<{ v: unknown }>("select coalesce(sum(base_paise),0) as v from payments where status = 'paid' and business_date >= $1::date and business_date < $2::date", [month, addMonths(month, 1)]))[0].v);
  const paidMonth = n((await d.query<{ v: unknown }>("select coalesce(sum(i.gross_paise),0) as v from incomes i join closings c on c.id = i.closing_id where i.kind = 'rank_reward' and c.closing_date >= $1::date", [month]))[0].v);
  const pending = await d.query<{ status: string; c: unknown; v: unknown }>("select status, count(*) as c, sum(amount_paise) as v from reward_instalments where status in ('pending','awaiting_approval') group by status");
  const owner = can(a, "plan");

  return (
    <div className="space-y-6">
      <PageHead title="Ranks and rewards" sub="Ranks are earned on lifetime renewal pairs made while the member was active (plus green directs, if set above 0). Rewards are paid through the daily closing, after TDS." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Reward pool this month" value={inr(bp(turnover, s.rewardPoolBp))} hint={`${s.rewardPoolBp / 100}% of ${inr(turnover)} turnover`} />
        <Stat label="Rank rewards paid this month" value={inr(paidMonth)} />
        <Stat label="Waiting for approval" value={inr(n(pending.find((p) => p.status === "awaiting_approval")?.v))} tone="red" />
        <Stat label="Upcoming instalments" value={inr(n(pending.find((p) => p.status === "pending")?.v))} hint={`${n(pending.find((p) => p.status === "pending")?.c)} payments`} />
      </div>

      {waiting.length > 0 && (
        <div className="card overflow-x-auto">
          <p className="font-bold p-4 pb-2">Rewards waiting for approval</p>
          <table className="grid-table">
            <thead><tr><th>Member</th><th>Rank</th><th>Achieved</th><th>Reward</th>{owner && <th>Decision</th>}</tr></thead>
            <tbody>{waiting.map((w) => (
              <tr key={`${w.member_id}-${w.level}`}>
                <td><Link href={`/admin/members/${w.code}`} className="font-mono text-brand-ink">{w.code as string}</Link> {w.name as string}</td>
                <td>{ranks.find((r) => r.level === n(w.level))?.name}</td><td>{dateFmt(w.achieved as string)}</td>
                <td className="font-semibold num">{inr(n(w.total))}{n(w.parts) > 1 ? ` (${n(w.parts)} instalments)` : ""}</td>
                {owner && <td className="min-w-[260px]"><div className="flex flex-wrap gap-2">
                  <ActionForm action={rewardDecisionAction} submit="Approve" className="[&>button]:w-auto"><input type="hidden" name="member" value={String(w.member_id)} /><input type="hidden" name="level" value={String(w.level)} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                  <ActionForm action={rewardDecisionAction} submit="Cancel" danger className="flex flex-wrap items-start gap-2 [&>button]:w-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap [&>p]:basis-full"><input type="hidden" name="member" value={String(w.member_id)} /><input type="hidden" name="level" value={String(w.level)} /><input type="hidden" name="decision" value="cancel" /><input name="note" placeholder="Reason" className="input w-32" required /></ActionForm>
                </div></td>}
              </tr>))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-5">
        <p className="font-bold mb-4">Rank table</p>
        <ActionForm action={rankTableAction} submit="Save ranks" className="space-y-4">
          <fieldset disabled={!owner}>
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead><tr><th></th><th>Name</th><th>Renewal pairs</th><th>Green directs</th><th>Reward ₹</th><th>Instalments</th><th>Active</th><th>Achieved by</th></tr></thead>
                <tbody>{ranks.map((r) => (
                  <tr key={r.level}>
                    <td><RankBadge level={r.level} name="" size="sm" /></td>
                    <td><input name={`name_${r.level}`} defaultValue={r.name} className="input w-36" aria-label={`Name of level ${r.level}`} /></td>
                    <td><input name={`pairs_${r.level}`} type="number" min={1} defaultValue={r.renewal_pairs} className="input w-28" aria-label="Renewal pairs" /></td>
                    <td><input name={`directs_${r.level}`} type="number" min={0} defaultValue={r.green_directs} className="input w-20" aria-label="Green directs" /></td>
                    <td><input name={`reward_${r.level}`} type="number" min={0} step="any" defaultValue={r.reward_paise / 100} className="input w-32" aria-label="Reward in rupees" /></td>
                    <td><input name={`inst_${r.level}`} type="number" min={1} max={120} defaultValue={r.instalments} className="input w-20" aria-label="Instalments" /></td>
                    <td><input name={`active_${r.level}`} type="checkbox" defaultChecked={r.active} className="h-4 w-4" aria-label="Active" /></td>
                    <td className="num">{counts.get(r.level) ?? 0}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 max-w-md"><label className="label" htmlFor="note">Reason for the change</label><input id="note" name="note" className="input" required /></div>
          </fieldset>
          {!owner && <p className="text-sm text-muted">Only the owner can change ranks.</p>}
        </ActionForm>
        <p className="mt-3 text-xs text-faint">Reward pool ({s.rewardPoolBp / 100}% of monthly turnover) and the approval limit ({inr(s.rankApprovalPaise)} and above) are in Plan settings.</p>
      </div>

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between p-4 pb-2"><p className="font-bold">Latest achievers</p>
          <a className="text-sm font-semibold text-brand-ink" href={withBase("/admin/reports/export?type=ranks")}>Download Excel</a></div>
        <table className="grid-table">
          <thead><tr><th>Date</th><th>Member</th><th>Rank</th><th>Reward</th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">No ranks achieved yet.</td></tr>}
            {recent.map((r, i) => (
              <tr key={i}><td>{dateFmt(r.achieved_on as string)}</td>
                <td><Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{r.code as string}</Link> {r.name as string}</td>
                <td><span className="inline-flex items-center gap-2"><RankBadge level={n(r.level)} name="" size="sm" />{r.rank_name as string}</span></td>
                <td className="num">{inr(n(r.reward_paise))}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
