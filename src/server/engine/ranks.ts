// Ranks and rank rewards. Called from inside the daily closing transaction, after the day's
// closing lines are written, so "lifetime renewal pairs" already includes today.

import { type Db, n } from "../db";
import { addDays } from "./dates";
import { bp } from "./matching";
import type { PlanSettings } from "./settings";

export type Rank = { level: number; name: string; renewal_pairs: number; green_directs: number; reward_paise: number; instalments: number; active: boolean };

export async function loadRanks(db: Db, activeOnly = true): Promise<Rank[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select level, name, renewal_pairs, green_directs, reward_paise, instalments, active from ranks
     ${activeOnly ? "where active" : ""} order by level`);
  return rows.map((r) => ({ level: n(r.level), name: r.name as string, renewal_pairs: n(r.renewal_pairs), green_directs: n(r.green_directs),
    reward_paise: n(r.reward_paise), instalments: n(r.instalments), active: !!r.active }));
}

/** Pairs that count for rank (owner's call, 24 Sep 2026): the total of BOTH binaries — new-sale and renewal — made
 *  while the member could earn (pairs flushed only by the daily cap still count). The ranks table column is still
 *  called renewal_pairs; it now means "pairs, both binaries". */
export const RANK_PAIRS_SQL = `select member_id, sum(pairs) as pairs from closing_lines
  where bin in ('new', 'renewal') and (reason is null or reason = 'daily cap') group by member_id`;

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export type Achievement = { member_id: number; level: number; name: string; reward_paise: number };

/** Award every rank a member now qualifies for and has not earned yet; create its instalments. */
export async function awardRanks(t: Db, date: string, closingId: number, s: PlanSettings,
  isEligible: (memberId: number) => Promise<boolean>): Promise<Achievement[]> {
  const ranks = await loadRanks(t);
  if (!ranks.length) return [];
  const min = Math.min(...ranks.map((r) => r.renewal_pairs));
  const cands = await t.query<Record<string, unknown>>(
    `with p as (${RANK_PAIRS_SQL})
     select p.member_id, p.pairs,
            (select count(*) from members d where d.sponsor_id = p.member_id and d.status = 'green') as directs,
            coalesce((select array_agg(level) from member_ranks r where r.member_id = p.member_id), '{}') as have
     from p where p.pairs >= $1`, [min]);
  const out: Achievement[] = [];
  for (const c of cands) {
    const memberId = n(c.member_id);
    const have = new Set((c.have as unknown[]).map(n));
    const due = ranks.filter((r) => !have.has(r.level) && n(c.pairs) >= r.renewal_pairs && n(c.directs) >= r.green_directs);
    if (!due.length || !(await isEligible(memberId))) continue;
    for (const r of due) {
      await t.query(
        `insert into member_ranks (member_id, level, rank_name, achieved_on, closing_id, reward_paise, instalments)
         values ($1, $2, $3, $4, $5, $6, $7)`, [memberId, r.level, r.name, date, closingId, r.reward_paise, r.instalments]);
      const status = s.rankApprovalPaise > 0 && r.reward_paise >= s.rankApprovalPaise ? "awaiting_approval" : "pending";
      const each = Math.floor(r.reward_paise / r.instalments);
      for (let i = 1; i <= r.instalments; i++) {
        const amount = i === r.instalments ? r.reward_paise - each * (r.instalments - 1) : each;
        if (amount <= 0) continue;
        await t.query(
          `insert into reward_instalments (member_id, level, seq, due_on, amount_paise, status) values ($1, $2, $3, $4, $5, $6)`,
          [memberId, r.level, i, addMonths(date, i - 1), amount, status]);
      }
      out.push({ member_id: memberId, level: r.level, name: r.name, reward_paise: r.reward_paise });
    }
  }
  return out;
}

export type RewardPayment = { instalmentId: number; member_id: number; amount_paise: number };

/** Instalments to pay in this closing: due, approved, member active, within the month's reward pool.
 *  An instalment whose member is not active on the day it is paid is skipped (not carried). One that
 *  does not fit in the pool stays pending and is paid on a later day. */
export async function dueRewards(t: Db, date: string, s: PlanSettings, isEligible: (memberId: number) => Promise<boolean>) {
  const rows = await t.query<Record<string, unknown>>(
    "select id, member_id, amount_paise from reward_instalments where status = 'pending' and due_on <= $1::date order by due_on, id", [date]);
  if (!rows.length) return { pay: [] as RewardPayment[], skipped: 0, deferred: 0 };
  const month = `${date.slice(0, 7)}-01`;
  const monthEnd = addDays(addMonths(month, 1), -1);
  const turnover = n((await t.query<{ v: unknown }>(
    "select coalesce(sum(base_paise), 0) as v from payments where status = 'paid' and business_date between $1::date and $2::date", [month, monthEnd]))[0].v);
  const already = n((await t.query<{ v: unknown }>(
    `select coalesce(sum(i.gross_paise), 0) as v from incomes i join closings c on c.id = i.closing_id
     where i.kind = 'rank_reward' and c.closing_date between $1::date and $2::date`, [month, monthEnd]))[0].v);
  let room = bp(turnover, s.rewardPoolBp) - already;
  const pay: RewardPayment[] = [];
  let skipped = 0;
  let deferred = 0;
  for (const r of rows) {
    const id = n(r.id); const memberId = n(r.member_id); const amount = n(r.amount_paise);
    if (!(await isEligible(memberId))) {
      await t.query("update reward_instalments set status = 'skipped', note = $2 where id = $1", [id, `Not active on ${date}`]);
      skipped++;
      continue;
    }
    if (amount > room) {
      await t.query("update reward_instalments set note = $2 where id = $1", [id, "Waiting for room in the monthly reward pool"]);
      deferred++;
      continue;
    }
    room -= amount;
    pay.push({ instalmentId: id, member_id: memberId, amount_paise: amount });
  }
  return { pay, skipped, deferred };
}
