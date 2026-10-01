// Daily closing: turns the day's BV into pairs and income, posts it to wallets.
// One closing per business date, strictly in date order, inside one transaction.
// A preview runs the exact same code and then rolls back.

import { type Db, maybeOne, n, one } from "../db";
import { insertMany } from "./bulk";
import { addDays, fyOf } from "./dates";
import { bp, cappedPairs, matchPairs } from "./matching";
import { RuleError } from "./members";
import { type PlanSettings, settingsFor } from "./settings";
import { awardRanks, dueRewards } from "./ranks";

type Bin = "new" | "renewal";
type IncomeKind = "direct" | "match_new" | "match_renewal" | "sponsor" | "rank_reward";

export type ClosingLine = {
  member_id: number; bin: Bin;
  open_left: number; open_right: number; in_left: number; in_right: number;
  pairs: number; paid_pairs: number; flushed_pairs: number;
  close_left: number; close_right: number; amount_paise: number; reason: string | null;
};

export type ClosingIncome = {
  member_id: number; kind: IncomeKind; gross_paise: number;
  source_member_id: number | null; bv_event_id: number | null; held: boolean;
  hold_reason?: "grace" | null;
};

export type ClosingSummary = {
  date: string;
  settingsId: number;
  events: number;
  members: number;
  pairs: { new: number; renewal: number };
  paidPairs: { new: number; renewal: number };
  flushedPairs: { new: number; renewal: number };
  income: Record<IncomeKind, number>;   // gross paise
  held: number;                          // gross paise not credited (income on hold)
  tds: number;
  adminCharge: number;
  credited: number;                      // net paise into wallets
  ranks?: { achieved: number; rewardsPaid: number; skipped: number; deferred: number };
  grace?: { held: number; released: number; forfeited: number };   // renewal income held in grace days (gross paise)
  turnover?: number;        // the day's paid subscriptions before GST (paise)
  payoutPct?: number;       // income of the day as % of that turnover
};

export type ClosingResult = { closingId: number | null; preview: boolean; summary: ClosingSummary; lines: ClosingLine[]; incomes: ClosingIncome[] };

type MemberInfo = {
  id: number; status: string; green_kind: string | null; green_date: string | null; blocked: boolean;
  income_hold: boolean; sub_valid_until: string | null; sponsor_id: number | null; pan: string | null;
};

const CLOSING_LOCK = 7_140_002;
class PreviewRollback extends Error { constructor(public result: ClosingResult) { super("preview"); } }

/** Why a member cannot earn in this binary on this date, or null when they can. */
export function ineligibleReason(m: MemberInfo | undefined, bin: Bin, date: string, s: PlanSettings): string | null {
  if (!m) return "unknown";
  if (m.blocked) return "blocked";
  if (m.status !== "green" || !m.green_date || m.green_date > date) return "red";
  if (m.green_kind === "complimentary" && !s.complimentaryEarns) return "complimentary";
  // Renewal income needs an active subscription, allowing a short grace after it ends.
  if (bin === "renewal" && !(m.sub_valid_until && addDays(m.sub_valid_until, s.renewalGraceDays) >= date)) return "own subscription not active";
  // Long-lapsed IDs stop earning new-sale income too. (IDs with no subscription date, like the company ID, are exempt.)
  if (bin === "new" && s.lapseStopsNewDays > 0 && m.sub_valid_until && addDays(m.sub_valid_until, s.lapseStopsNewDays) < date) return "subscription lapsed too long";
  return null;
}

async function loadMembers(db: Db, ids: number[]): Promise<Map<number, MemberInfo>> {
  const map = new Map<number, MemberInfo>();
  if (ids.length === 0) return map;
  const rows = await db.query<Record<string, unknown>>(
    `select id, status, green_kind, green_date::text, blocked, income_hold, sub_valid_until::text, sponsor_id, pan
     from members where id = any($1::bigint[])`, [ids]);
  for (const r of rows) {
    map.set(n(r.id), {
      id: n(r.id), status: r.status as string, green_kind: (r.green_kind as string) ?? null,
      green_date: (r.green_date as string) ?? null, blocked: !!r.blocked, income_hold: !!r.income_hold,
      sub_valid_until: (r.sub_valid_until as string) ?? null,
      sponsor_id: r.sponsor_id === null ? null : n(r.sponsor_id), pan: (r.pan as string) ?? null,
    });
  }
  return map;
}

export async function runClosing(db: Db, date: string, opts: { adminId?: number | null; preview?: boolean } = {}): Promise<ClosingResult> {
  try {
    return await db.tx((t) => closeInTx(t, date, opts));
  } catch (e) {
    if (e instanceof PreviewRollback) return e.result;
    throw e;
  }
}

async function closeInTx(t: Db, date: string, opts: { adminId?: number | null; preview?: boolean }): Promise<ClosingResult> {
  await t.query("select pg_advisory_xact_lock($1)", [CLOSING_LOCK]);
  if (await maybeOne(t, "select 1 from closings where closing_date = $1", [date]))
    throw new RuleError(`The closing for ${date} is already posted.`);
  const later = await maybeOne<{ d: string }>(t, "select max(closing_date)::text as d from closings");
  if (later?.d && later.d > date) throw new RuleError(`A later closing (${later.d}) is already posted.`);

  const { id: settingsId, s } = await settingsFor(t, date);
  const closing = await one<{ id: unknown }>(t,
    "insert into closings (closing_date, settings_id, posted_by, summary) values ($1, $2, $3, '{}'::jsonb) returning id",
    [date, settingsId, opts.adminId ?? null]);
  const closingId = n(closing.id);

  // 1. Today's open BV events (anything not closed yet, up to and including this date).
  const events = (await t.query<Record<string, unknown>>(
    `select e.id, e.member_id, e.bin, e.bv, e.reverses_id, m.sponsor_id
     from bv_events e join members m on m.id = e.member_id
     where e.closing_id is null and not e.void and e.event_date <= $1::date`, [date]))
    .map((r) => ({ id: n(r.id), member_id: n(r.member_id), bin: r.bin as Bin, bv: n(r.bv),
                   reverses: r.reverses_id !== null, sponsor_id: r.sponsor_id === null ? null : n(r.sponsor_id) }));

  // 2. Push every event's BV up the placement tree: each ancestor gets it on the side it came from.
  const volumes = await t.query<Record<string, unknown>>(
    `with recursive up as (
       select e.bin, e.bv, m.parent_id as anc, m.leg as side
       from bv_events e join members m on m.id = e.member_id
       where e.closing_id is null and not e.void and e.event_date <= $1::date and m.parent_id is not null
       union all
       select up.bin, up.bv, m.parent_id, m.leg from up join members m on m.id = up.anc where m.parent_id is not null
     )
     select anc, bin,
            coalesce(sum(bv) filter (where side = 'L'), 0) as l,
            coalesce(sum(bv) filter (where side = 'R'), 0) as r
     from up group by anc, bin`, [date]);

  const ids = new Set<number>();
  for (const v of volumes) ids.add(n(v.anc));
  for (const e of events) if (e.sponsor_id) ids.add(e.sponsor_id);
  const members = await loadMembers(t, [...ids]);

  const stateRows = ids.size
    ? await t.query<Record<string, unknown>>(
        "select member_id, bin, carry_left, carry_right, first_pair_done from binary_state where member_id = any($1::bigint[])", [[...ids]])
    : [];
  const state = new Map(stateRows.map((r) => [`${n(r.member_id)}:${r.bin}`, r]));

  // 3. Match pairs for every member whose legs received volume today.
  const lines: ClosingLine[] = [];
  const incomes: ClosingIncome[] = [];
  const newStates: Record<string, unknown>[] = [];
  const renewalPaid = new Map<number, number>();

  for (const v of volumes) {
    const memberId = n(v.anc);
    const bin = v.bin as Bin;
    const st = state.get(`${memberId}:${bin}`);
    const openL = st ? n(st.carry_left) : 0;
    const openR = st ? n(st.carry_right) : 0;
    const inL = n(v.l);
    const inR = n(v.r);
    const m = matchPairs({
      openLeft: openL, openRight: openR, inLeft: inL, inRight: inR,
      firstPairDone: st ? !!st.first_pair_done : false, pairBv: s.pairBv, firstPairRatio: s.firstPairRatio,
    });
    const why = m.pairs > 0 ? ineligibleReason(members.get(memberId), bin, date, s) : null;
    const paid = m.pairs > 0 && !why ? cappedPairs(m.pairs, s.pairIncomePaise, s.dailyCapPaise) : 0;
    const amount = paid * s.pairIncomePaise;
    const flushed = m.pairs - paid;
    lines.push({
      member_id: memberId, bin, open_left: openL, open_right: openR, in_left: inL, in_right: inR,
      pairs: m.pairs, paid_pairs: paid, flushed_pairs: flushed, close_left: m.closeLeft, close_right: m.closeRight,
      amount_paise: amount, reason: why ?? (flushed > 0 ? "daily cap" : null),
    });
    newStates.push({ member_id: memberId, bin, carry_left: m.closeLeft, carry_right: m.closeRight,
      in_left: inL, in_right: inR, first_pair_done: m.firstPairDone, pairs: m.pairs });
    if (amount > 0) {
      const info = members.get(memberId)!;
      // Renewal income earned in the grace days after the member's own subscription ended waits for their renewal.
      const grace = bin === "renewal" && s.renewalGraceHold && !!info.sub_valid_until && info.sub_valid_until < date;
      incomes.push({ member_id: memberId, kind: bin === "new" ? "match_new" : "match_renewal", gross_paise: amount,
        source_member_id: null, bv_event_id: null, held: info.income_hold || grace, hold_reason: grace ? "grace" : null });
      if (bin === "renewal") renewalPaid.set(memberId, amount);
    }
  }

  // 3b. Company ceiling: the day's matching in each binary (with the sponsor bonus it drives, for renewals) never
  //     exceeds binaryCeilingPaise for every sale that day. Above it, every pair of that binary is paid pro rata.
  if (s.binaryCeilingPaise > 0) {
    for (const bin of ["new", "renewal"] as const) {
      const sales = events.filter((e) => e.bin === bin && e.bv > 0 && !e.reverses).length;
      const kind = bin === "new" ? "match_new" : "match_renewal";
      const paid = incomes.filter((i) => i.kind === kind).reduce((a, i) => a + i.gross_paise, 0);
      const load = bin === "renewal" ? paid * (1 + s.sponsorBonusBp / 10000) : paid;
      const pool = sales * s.binaryCeilingPaise;
      if (paid <= 0 || load <= pool) continue;
      const factor = pool / load;
      for (const i of incomes) if (i.kind === kind) i.gross_paise = Math.floor(i.gross_paise * factor);
      for (const l of lines) if (l.bin === bin && l.amount_paise > 0) {
        l.amount_paise = Math.floor(l.amount_paise * factor);
        l.reason = l.reason ? `${l.reason}, company ceiling` : "company ceiling";
      }
      if (bin === "renewal") for (const [k, v] of renewalPaid) renewalPaid.set(k, Math.floor(v * factor));
    }
    for (let k = incomes.length - 1; k >= 0; k--) if (incomes[k].gross_paise <= 0) incomes.splice(k, 1);
  }

  // 4. Sponsor Bonus: a share of each direct's renewal matching, no cap.
  const sponsorIds = [...renewalPaid.keys()].map((id) => members.get(id)?.sponsor_id).filter((x): x is number => !!x);
  const missing = sponsorIds.filter((id) => !members.has(id));
  if (missing.length) for (const [k, v] of await loadMembers(t, missing)) members.set(k, v);
  for (const [memberId, amount] of renewalPaid) {
    const sponsorId = members.get(memberId)?.sponsor_id;
    if (!sponsorId) continue;
    const sp = members.get(sponsorId);
    if (ineligibleReason(sp, "renewal", date, s)) continue;
    const gross = bp(amount, s.sponsorBonusBp);
    if (gross > 0) incomes.push({ member_id: sponsorId, kind: "sponsor", gross_paise: gross,
      source_member_id: memberId, bv_event_id: null, held: sp!.income_hold });
  }

  // 5. Direct Sale Bonus on each new paid subscription.
  for (const e of events) {
    if (e.bin !== "new" || e.bv <= 0 || e.reverses || !e.sponsor_id) continue;
    const sp = members.get(e.sponsor_id);
    if (ineligibleReason(sp, "new", date, s)) continue;
    const gross = bp(e.bv * s.bvValuePaise, s.directBonusBp);
    if (gross > 0) incomes.push({ member_id: e.sponsor_id, kind: "direct", gross_paise: gross,
      source_member_id: e.member_id, bv_event_id: e.id, held: sp!.income_hold });
    // Paid as Shubhora AI credits instead of cash: queued here, pushed to the Suite by processSuiteSync.
    if (s.directBonusCredits > 0 && !sp!.income_hold) {
      await t.query(
        `insert into suite_credit_sync (ref, member_id, credits, source_member_id) values ($1, $2, $3, $4) on conflict (ref) do nothing`,
        [`direct-${e.id}`, e.sponsor_id, s.directBonusCredits, e.member_id]);
    }
  }

  // 6. Persist lines, states, incomes.
  await insertMany(t, "closing_lines", {
    closing_id: "bigint", member_id: "bigint", bin: "text", open_left: "bigint", open_right: "bigint",
    in_left: "bigint", in_right: "bigint", pairs: "int", paid_pairs: "int", flushed_pairs: "int",
    close_left: "bigint", close_right: "bigint", amount_paise: "bigint", reason: "text",
  }, lines.map((l) => ({ ...l, closing_id: closingId })));

  if (newStates.length) {
    await t.query(
      `insert into binary_state (member_id, bin, carry_left, carry_right, total_left, total_right, first_pair_done, pairs_total)
       select member_id, bin, carry_left, carry_right, in_left, in_right, first_pair_done, pairs
       from jsonb_to_recordset($1::text::jsonb) as x(member_id bigint, bin text, carry_left bigint, carry_right bigint,
            in_left bigint, in_right bigint, first_pair_done boolean, pairs bigint)
       on conflict (member_id, bin) do update set
         carry_left = excluded.carry_left, carry_right = excluded.carry_right,
         total_left = binary_state.total_left + excluded.total_left,
         total_right = binary_state.total_right + excluded.total_right,
         first_pair_done = excluded.first_pair_done,
         pairs_total = binary_state.pairs_total + excluded.pairs_total`,
      [JSON.stringify(newStates)]);
  }

  const incomeRows = await insertMany(t, "incomes", {
    member_id: "bigint", closing_id: "bigint", kind: "text", gross_paise: "bigint",
    source_member_id: "bigint", bv_event_id: "bigint", held: "boolean", hold_reason: "text",
  }, incomes.map((i) => ({ ...i, hold_reason: i.hold_reason ?? null, closing_id: closingId })), "id, member_id, gross_paise, held");

  // 6a. Grace holds from earlier days: renewed in time → released into today's credit; grace over → forfeited.
  const released = await t.query<{ id: unknown; member_id: unknown; gross_paise: unknown }>(
    `update incomes i set held = false, released_at = now()
     from members m, closings c
     where i.member_id = m.id and c.id = i.closing_id and i.hold_reason = 'grace' and i.held
       and i.released_at is null and i.forfeited_at is null and i.closing_id <> $1
       and not m.income_hold and not m.blocked and m.sub_valid_until >= c.closing_date
     returning i.id, i.member_id, i.gross_paise`, [closingId]);
  for (const r of released) incomeRows.push({ id: r.id, member_id: r.member_id, gross_paise: r.gross_paise, held: false });
  // 6a-ii. Income held because an admin had switched "Hold income" on (hold_reason is null, not grace): when the
  // hold is taken off, that money is released into the next closing's credit. Nothing released it before, so
  // turning the switch off left the member's earnings held for good.
  const unheld = await t.query<{ id: unknown; member_id: unknown; gross_paise: unknown }>(
    `update incomes i set held = false, released_at = now()
     from members m
     where i.member_id = m.id and i.hold_reason is null and i.held
       and i.released_at is null and i.forfeited_at is null and i.closing_id <> $1
       and not m.income_hold and not m.blocked
     returning i.id, i.member_id, i.gross_paise`, [closingId]);
  for (const r of unheld) incomeRows.push({ id: r.id, member_id: r.member_id, gross_paise: r.gross_paise, held: false });
  const forfeited = await t.query<{ gross_paise: unknown }>(
    `update incomes i set forfeited_at = now(), note = 'Own subscription not renewed within the grace days'
     from members m
     where i.member_id = m.id and i.hold_reason = 'grace' and i.held and i.released_at is null and i.forfeited_at is null
       and (m.sub_valid_until is null or m.sub_valid_until + $2::int < $1::date)
     returning i.gross_paise`, [date, s.renewalGraceDays]);

  // 6b. Ranks earned today, then rank reward instalments due today (paid as income, so TDS applies).
  const rankEligible = async (memberId: number) => {
    if (!members.has(memberId)) for (const [k, v] of await loadMembers(t, [memberId])) members.set(k, v);
    return ineligibleReason(members.get(memberId), "renewal", date, s) === null;
  };
  const achieved = await awardRanks(t, date, closingId, s, rankEligible);
  const rewards = await dueRewards(t, date, s, rankEligible);
  for (const r of rewards.pay) {
    const held = members.get(r.member_id)!.income_hold;
    const row = await one<{ id: unknown }>(t,
      `insert into incomes (member_id, closing_id, kind, gross_paise, held, note) values ($1, $2, 'rank_reward', $3, $4, $5) returning id`,
      [r.member_id, closingId, r.amount_paise, held, `Rank reward instalment #${r.instalmentId}`]);
    await t.query("update reward_instalments set status = 'paid', paid_closing_id = $2, income_id = $3, note = null where id = $1",
      [r.instalmentId, closingId, row.id]);
    incomes.push({ member_id: r.member_id, kind: "rank_reward", gross_paise: r.amount_paise, source_member_id: null, bv_event_id: null, held });
    incomeRows.push({ id: row.id, member_id: r.member_id, gross_paise: r.amount_paise, held });
  }

  // 7. Credit wallets: gross income, then TDS and admin charge per member.
  const fy = fyOf(date);
  const credit = incomeRows.filter((r) => !r.held);
  const byMember = new Map<number, number>();
  for (const r of credit) byMember.set(n(r.member_id), (byMember.get(n(r.member_id)) ?? 0) + n(r.gross_paise));
  const ledgerRows: Record<string, unknown>[] = credit.map((r) => ({
    member_id: n(r.member_id), entry: "income", amount_paise: n(r.gross_paise), fy, income_id: n(r.id), closing_id: closingId,
  }));
  let tdsTotal = 0;
  let adminTotal = 0;
  if (byMember.size) {
    const prior = new Map((await t.query<Record<string, unknown>>(
      `select member_id, sum(amount_paise) as total from ledger
       where fy = $1 and entry = 'income' and member_id = any($2::bigint[]) group by member_id`,
      [fy, [...byMember.keys()]])).map((r) => [n(r.member_id), n(r.total)]));
    for (const [memberId, today] of byMember) {
      const before = prior.get(memberId) ?? 0;
      const base = before > s.tdsThresholdPaise ? today : before + today > s.tdsThresholdPaise ? before + today : 0;
      const rate = members.get(memberId)?.pan ? s.tdsWithPanBp : s.tdsWithoutPanBp;
      const tds = bp(base, rate);
      const admin = bp(today, s.adminChargeBp);
      if (tds > 0) ledgerRows.push({ member_id: memberId, entry: "tds", amount_paise: -tds, fy, income_id: null, closing_id: closingId });
      if (admin > 0) ledgerRows.push({ member_id: memberId, entry: "admin_charge", amount_paise: -admin, fy, income_id: null, closing_id: closingId });
      tdsTotal += tds;
      adminTotal += admin;
    }
  }
  await insertMany(t, "ledger", {
    member_id: "bigint", entry: "text", amount_paise: "bigint", fy: "text", income_id: "bigint", closing_id: "bigint",
  }, ledgerRows);

  if (events.length)
    await t.query("update bv_events set closing_id = $1 where id = any($2::bigint[])", [closingId, events.map((e) => e.id)]);

  // 8. Summary (with the day's turnover, so the payout share can be watched).
  const turnover = n((await one<{ s: unknown }>(t,
    "select coalesce(sum(base_paise), 0) as s from payments where status = 'paid' and method <> 'complimentary' and business_date = $1::date", [date])).s);
  const sum = (k: IncomeKind) => incomes.filter((i) => i.kind === k).reduce((a, i) => a + i.gross_paise, 0);
  const byBin = (bin: Bin, f: (l: ClosingLine) => number) => lines.filter((l) => l.bin === bin).reduce((a, l) => a + f(l), 0);
  const grossCredited = [...byMember.values()].reduce((a, b) => a + b, 0);
  const summary: ClosingSummary = {
    date, settingsId, events: events.length, members: new Set(lines.map((l) => l.member_id)).size,
    pairs: { new: byBin("new", (l) => l.pairs), renewal: byBin("renewal", (l) => l.pairs) },
    paidPairs: { new: byBin("new", (l) => l.paid_pairs), renewal: byBin("renewal", (l) => l.paid_pairs) },
    flushedPairs: { new: byBin("new", (l) => l.flushed_pairs), renewal: byBin("renewal", (l) => l.flushed_pairs) },
    income: { direct: sum("direct"), match_new: sum("match_new"), match_renewal: sum("match_renewal"), sponsor: sum("sponsor"), rank_reward: sum("rank_reward") },
    held: incomes.filter((i) => i.held).reduce((a, i) => a + i.gross_paise, 0),
    tds: tdsTotal, adminCharge: adminTotal, credited: grossCredited - tdsTotal - adminTotal,
    ranks: { achieved: achieved.length, rewardsPaid: sum("rank_reward"), skipped: rewards.skipped, deferred: rewards.deferred },
    grace: {
      held: incomes.filter((i) => i.hold_reason === "grace").reduce((a, i) => a + i.gross_paise, 0),
      released: released.reduce((a, r) => a + n(r.gross_paise), 0),
      forfeited: forfeited.reduce((a, r) => a + n(r.gross_paise), 0),
    },
    turnover, payoutPct: turnover > 0 ? Math.round((incomes.reduce((a, i) => a + i.gross_paise, 0) / turnover) * 1000) / 10 : 0,
  };
  await t.query("update closings set summary = $2::text::jsonb where id = $1", [closingId, JSON.stringify(summary)]);

  const result: ClosingResult = { closingId: opts.preview ? null : closingId, preview: !!opts.preview, summary, lines, incomes };
  if (opts.preview) throw new PreviewRollback(result);
  return result;
}

/** Run every missing closing up to `through` (inclusive), oldest first. Used by the nightly job. */
export async function runPendingClosings(db: Db, through: string, firstDate: string): Promise<ClosingSummary[]> {
  const last = await maybeOne<{ d: string | null }>(db, "select max(closing_date)::text as d from closings");
  const out: ClosingSummary[] = [];
  let d = last?.d ? nextDay(last.d) : firstDate;
  while (d <= through) {
    out.push((await runClosing(db, d)).summary);
    d = nextDay(d);
  }
  return out;
}

function nextDay(date: string): string {
  const x = new Date(`${date}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
