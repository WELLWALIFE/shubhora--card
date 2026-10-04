import { z } from "zod";
import { type Db, maybeOne, n } from "../db";

/** Every number in the compensation plan. Stored as versioned rows in plan_settings with an
 *  effective_from date; a closing always uses the version in force on its own date.
 *  Percentages are in basis points (1% = 100 bp). Money is in paise. */
export const PlanSettings = z.object({
  bvPerSubscription: z.number().int().positive(),          // BV created by one paid subscription
  bvValuePaise: z.number().int().positive(),               // 1 BV = ₹1
  directBonusBp: z.number().int().min(0).max(10000),       // Direct Sale Bonus, % of BV
  directBonusCredits: z.number().int().min(0).max(1000),   // Direct Sale Bonus paid as Suite AI credits instead (per new sale)
  pairBv: z.number().int().positive(),                     // BV on each side for one pair
  pairIncomePaise: z.number().int().min(0),                // income per matched pair
  dailyCapPaise: z.number().int().min(0),                  // matching cap per day, per binary
  binaryCeilingPaise: z.number().int().min(0),             // company ceiling: most matching (+ sponsor bonus) paid per sale, per binary, per day (0 = none)
  firstPairRatio: z.boolean(),                             // first pair 2:1 or 1:2, then 1:1
  sponsorBonusBp: z.number().int().min(0).max(10000),      // % of directs' renewal matching
  complimentaryEarns: z.boolean(),                         // can a complimentary-green ID earn?
  tdsWithPanBp: z.number().int().min(0).max(10000),
  tdsWithoutPanBp: z.number().int().min(0).max(10000),
  tdsThresholdPaise: z.number().int().min(0),              // per financial year
  adminChargeBp: z.number().int().min(0).max(10000),
  subscriptionBasePaise: z.number().int().positive(),      // ₹3,000
  gstBp: z.number().int().min(0).max(10000),               // 18%
  minWithdrawalPaise: z.number().int().min(0),
  redExpiryDays: z.number().int().min(0),                  // 0 = never
  rewardPoolBp: z.number().int().min(0).max(10000),        // rank rewards per month, % of that month's turnover
  rankApprovalPaise: z.number().int().min(0),              // rank rewards of this size or more wait for admin approval (0 = never)
  renewalGraceDays: z.number().int().min(0).max(30),       // renewal income keeps running this many days after the subscription ends
  renewalGraceHold: z.boolean(),                           // grace-day renewal income is held: paid if the member renews in time, else forfeited
  lapseStopsNewDays: z.number().int().min(0).max(3650),    // after this many days lapsed, new-sale income stops too (0 = never)
});
export type PlanSettings = z.infer<typeof PlanSettings>;

export const DEFAULT_SETTINGS: PlanSettings = {
  bvPerSubscription: 2500,
  bvValuePaise: 100,
  directBonusBp: 1000,
  directBonusCredits: 0,
  pairBv: 2500,
  pairIncomePaise: 50000,
  dailyCapPaise: 500000,
  binaryCeilingPaise: 0,
  firstPairRatio: true,
  sponsorBonusBp: 2000,
  complimentaryEarns: true,
  tdsWithPanBp: 200,
  tdsWithoutPanBp: 2000,
  tdsThresholdPaise: 2000000,
  adminChargeBp: 0,
  subscriptionBasePaise: 300000,
  gstBp: 1800,
  minWithdrawalPaise: 50000,
  redExpiryDays: 0,
  rewardPoolBp: 500,
  rankApprovalPaise: 1000000,
  renewalGraceDays: 3,
  renewalGraceHold: false,
  lapseStopsNewDays: 90,
};

export async function settingsFor(db: Db, date: string): Promise<{ id: number; s: PlanSettings }> {
  const row = await maybeOne<{ id: unknown; values: unknown }>(
    db,
    `select id, values from plan_settings where effective_from <= $1::date
     order by effective_from desc, id desc limit 1`,
    [date],
  );
  if (!row) throw new Error(`no plan settings in force on ${date}`);
  const values = typeof row.values === "string" ? JSON.parse(row.values) : row.values;
  return { id: n(row.id), s: PlanSettings.parse({ ...DEFAULT_SETTINGS, ...(values as object) }) };
}

export async function saveSettings(
  db: Db, effectiveFrom: string, values: PlanSettings, note: string, adminId: number | null,
): Promise<number> {
  const parsed = PlanSettings.parse(values);
  const rows = await db.query<{ id: unknown }>(
    `insert into plan_settings (effective_from, values, note, created_by) values ($1, $2::text::jsonb, $3, $4) returning id`,
    [effectiveFrom, JSON.stringify(parsed), note, adminId],
  );
  return n(rows[0].id);
}
