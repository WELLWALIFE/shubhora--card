import { describe, expect, it } from "vitest";
import { runClosing } from "@/server/engine/closing";
import { recordPayment } from "@/server/engine/payments";
import type { PlanSettings } from "@/server/engine/settings";
import { balance, freshDb, incomeOf, join, rs } from "./helpers";

const D1 = "2026-10-01";
const D2 = "2026-10-02";

/** X with three paid directs (2 left, 1 right) → 1 new-sale pair on D1. On D2 everyone renews → 1 renewal pair.
 *  Ranks count BOTH binaries (owner's call, 24 Sep 2026), so the test ladder needs 2 pairs: D1 alone is not enough. */
async function team(settings: Partial<PlanSettings> = {}) {
  const { db, root } = await freshDb({ tdsThresholdPaise: rs(1_000_000), ...settings });
  // Small test ladder: level 1 at 2 pairs (₹1,000 at once), level 2 at 2 pairs (₹3,000 in 3 instalments).
  await db.query("update ranks set active = false where level > 2");
  await db.query("update ranks set renewal_pairs = 2, green_directs = 3, reward_paise = $1, instalments = 1 where level = 1", [rs(1000)]);
  await db.query("update ranks set renewal_pairs = 2, green_directs = 3, reward_paise = $1, instalments = 3 where level = 2", [rs(3000)]);
  const x = await join(db, root.code, "L", { activate: D1, name: "Member X" });
  const kids = [await join(db, x.code, "L", { activate: D1 }), await join(db, x.code, "L", { activate: D1 }), await join(db, x.code, "R", { activate: D1 })];
  await runClosing(db, D1);
  const renewAll = async (date: string, who = [x, ...kids]) => {
    for (const k of who) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date, reference: `ren_${k.code}_${date}` });
  };
  return { db, root, x, kids, renewAll };
}

const ranksOf = async (db: Awaited<ReturnType<typeof freshDb>>["db"], id: number) =>
  (await db.query<{ level: unknown }>("select level from member_ranks where member_id = $1 order by level", [id])).map((r) => Number(r.level));

describe("ranks", () => {
  it("are earned on pairs (new + renewal) with enough green directs, and pay the reward as income", async () => {
    const { db, x, renewAll } = await team({ rankApprovalPaise: 0, rewardPoolBp: 10000 });
    const before = await balance(db, x.id);
    await renewAll(D2);
    const r = await runClosing(db, D2);
    expect(await ranksOf(db, x.id)).toEqual([1, 2]);
    expect(r.summary.ranks?.achieved).toBe(2);
    // ₹1,000 at once + first of three ₹1,000 instalments = ₹2,000 rank reward today.
    expect(await incomeOf(db, x.id, "rank_reward")).toBe(rs(2000));
    expect(await balance(db, x.id) - before).toBe(rs(500) + rs(2000)); // renewal matching + rewards
  });

  it("new-sale pairs count too: two new pairs earn the rank without any renewal", async () => {
    const { db, x } = await team({ rankApprovalPaise: 0 });
    expect(await ranksOf(db, x.id)).toEqual([]);          // 1 pair after D1 — not enough yet
    await join(db, x.code, "L", { activate: D2 });         // one more on each side → 2nd new-sale pair
    await join(db, x.code, "R", { activate: D2 });         // (D1's extra left volume does not carry over)
    await runClosing(db, D2);
    expect(await ranksOf(db, x.id)).toEqual([1, 2]);
  });

  it("is not earned while the member's own subscription has lapsed", async () => {
    const { db, x, kids, renewAll } = await team({ rankApprovalPaise: 0 });
    await renewAll(D2, kids);
    await db.query("update members set sub_valid_until = '2026-09-25' where id = $1", [x.id]);
    await runClosing(db, D2);
    expect(await ranksOf(db, x.id)).toEqual([]);
  });

  it("big rewards wait for admin approval", async () => {
    const { db, x, renewAll } = await team({ rankApprovalPaise: rs(2000), rewardPoolBp: 10000 });
    await renewAll(D2);
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "rank_reward")).toBe(rs(1000)); // level 2 (₹3,000) is waiting
    await db.query("update reward_instalments set status = 'pending' where status = 'awaiting_approval'");
    await runClosing(db, "2026-10-03");
    expect(await incomeOf(db, x.id, "rank_reward")).toBe(rs(2000));
  });

  it("pays later instalments monthly and skips a month when the member is not active", async () => {
    const { db, x, kids, renewAll } = await team({ rankApprovalPaise: 0, rewardPoolBp: 10000 });
    await renewAll(D2);
    await runClosing(db, D2);
    await renewAll("2026-11-02", [kids[0]]);  // some November turnover, so the month's reward pool is not empty
    await runClosing(db, "2026-11-02");       // X's renewal on D2 keeps him active till 30 Nov
    expect(await incomeOf(db, x.id, "rank_reward")).toBe(rs(3000));
    await runClosing(db, "2026-12-02");       // within the 3-day grace: kept pending (December pool is empty)
    await runClosing(db, "2026-12-05");       // past the grace: this month's instalment is missed
    const st = await db.query<{ seq: unknown; status: string }>("select seq, status from reward_instalments where member_id = $1 and level = 2 order by seq", [x.id]);
    expect(st.map((r) => r.status)).toEqual(["paid", "paid", "skipped"]);
  });

  it("stays pending when the monthly reward pool is full", async () => {
    const { db, x, renewAll } = await team({ rankApprovalPaise: 0, rewardPoolBp: 1 });
    await renewAll(D2);
    const r = await runClosing(db, D2);
    expect(r.summary.ranks?.deferred).toBe(2);
    expect(await incomeOf(db, x.id, "rank_reward")).toBe(0);
    const st = await db.query<{ status: string }>("select status from reward_instalments where member_id = $1 and seq = 1", [x.id]);
    expect(st.every((s) => s.status === "pending")).toBe(true);
  });
});
