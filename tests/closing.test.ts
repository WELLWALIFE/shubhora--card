import { describe, expect, it } from "vitest";
import { runClosing } from "@/server/engine/closing";
import { registerMember } from "@/server/engine/members";
import { recordPayment, refundPayment } from "@/server/engine/payments";
import { balance, freshDb, incomeOf, join, rs, state } from "./helpers";

const D1 = "2026-10-01";
const D2 = "2026-10-02";
const D3 = "2026-10-03";

describe("placement", () => {
  it("places new IDs at the bottom of the chosen leg", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L");
    const b = await join(db, root.code, "L");
    expect(a.parentId).toBe(root.id);
    expect(b.parentId).toBe(a.id);
  });

  it("rejects an exact position outside the sponsor's team and a filled slot", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L");
    const b = await join(db, root.code, "R");
    await expect(join(db, a.code, "L", { parentCode: b.code })).rejects.toThrow(/sponsor's own team/);
    await join(db, a.code, "L", { parentCode: a.code });
    await expect(join(db, a.code, "L", { parentCode: a.code })).rejects.toThrow(/already filled/);
  });

  it("allows one ID per mobile number", async () => {
    const { db, root } = await freshDb();
    await registerMember(db, { sponsorCode: root.code, leg: "L", name: "Asha", mobile: "9876543210", password: "password123" });
    await expect(registerMember(db, { sponsorCode: root.code, leg: "R", name: "Bina", mobile: "+91 98765 43210", password: "password123" }))
      .rejects.toThrow(/already has an ID/);
  });
});

describe("new sale binary", () => {
  it("pays Direct Sale Bonus and the first pair on 2:1", async () => {
    const { db, root } = await freshDb();
    await join(db, root.code, "L", { activate: D1 });
    await join(db, root.code, "L", { activate: D1 });
    await join(db, root.code, "R", { activate: D1 });
    const r = await runClosing(db, D1);
    expect(await incomeOf(db, root.id, "direct")).toBe(rs(750));
    expect(await incomeOf(db, root.id, "match_new")).toBe(rs(500));
    expect(r.summary.pairs.new).toBe(1);
    expect(await state(db, root.id, "new")).toMatchObject({ L: 0, R: 0, first: true });
  });

  it("1:1 waits for the first pair and carries forward", async () => {
    const { db, root } = await freshDb();
    await join(db, root.code, "L", { activate: D1 });
    await join(db, root.code, "R", { activate: D1 });
    await runClosing(db, D1);
    expect(await incomeOf(db, root.id, "match_new")).toBe(0);
    expect(await state(db, root.id, "new")).toMatchObject({ L: 2500, R: 2500, first: false });
    await join(db, root.code, "R", { activate: D2 });
    await runClosing(db, D2);
    expect(await incomeOf(db, root.id, "match_new")).toBe(rs(500));
    expect(await state(db, root.id, "new")).toMatchObject({ L: 0, R: 0, first: true });
  });

  it("caps at ₹5,000 a day and flushes the extra pairs", async () => {
    const { db, root } = await freshDb();
    for (let i = 0; i < 12; i++) await join(db, root.code, "L", { activate: D1 });
    for (let i = 0; i < 12; i++) await join(db, root.code, "R", { activate: D1 });
    const r = await runClosing(db, D1);
    const line = r.lines.find((l) => l.member_id === root.id && l.bin === "new")!;
    expect(line).toMatchObject({ pairs: 11, paid_pairs: 10, flushed_pairs: 1, close_left: 0, close_right: 2500 });
    expect(await incomeOf(db, root.id, "match_new")).toBe(rs(5000));
  });

  it("a Red ID's pairs are flushed and never paid later", async () => {
    const { db, root } = await freshDb();
    const red = await join(db, root.code, "L");
    await join(db, red.code, "L", { activate: D1 });
    await join(db, red.code, "L", { activate: D1 });
    await join(db, red.code, "R", { activate: D1 });
    const r = await runClosing(db, D1);
    const line = r.lines.find((l) => l.member_id === red.id)!;
    expect(line).toMatchObject({ pairs: 1, paid_pairs: 0, reason: "red" });
    expect(await incomeOf(db, red.id)).toBe(0);
    await recordPayment(db, { memberId: red.id, kind: "activation", method: "online", date: D2, reference: "pay_late" });
    await runClosing(db, D2);
    expect(await incomeOf(db, red.id)).toBe(0);
  });

  it("no Direct Sale Bonus to a Red sponsor", async () => {
    const { db, root } = await freshDb();
    const red = await join(db, root.code, "L");
    await join(db, red.code, "L", { activate: D1 });
    await runClosing(db, D1);
    expect(await incomeOf(db, red.id, "direct")).toBe(0);
  });

  it("complimentary green creates no BV and no bonus", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L");
    await recordPayment(db, { memberId: a.id, kind: "activation", method: "complimentary", date: D1, reason: "Staff ID", adminId: 1 });
    const r = await runClosing(db, D1);
    expect(r.summary.events).toBe(0);
    expect(await incomeOf(db, root.id)).toBe(0);
  });

  it("offline payment creates BV and an invoice", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L");
    const p = await recordPayment(db, { memberId: a.id, kind: "activation", method: "offline", date: D1, reference: "UTR123", reason: "Bank transfer", adminId: 1 });
    expect(p.invoiceNo).toBe("SHB/2026-27/000001");
    await runClosing(db, D1);
    expect(await incomeOf(db, root.id, "direct")).toBe(rs(250));
  });

  it("the same online payment is applied only once", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L");
    await recordPayment(db, { memberId: a.id, kind: "activation", method: "online", date: D1, reference: "pay_X" });
    const again = await recordPayment(db, { memberId: a.id, kind: "activation", method: "online", date: D1, reference: "pay_X" });
    expect(again.duplicate).toBe(true);
  });
});

describe("renewal binary and Sponsor Bonus", () => {
  async function renewalTeam() {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { activate: D1, name: "Member X" });
    const kids = [
      await join(db, x.code, "L", { activate: D1 }),
      await join(db, x.code, "L", { activate: D1 }),
      await join(db, x.code, "R", { activate: D1 }),
    ];
    await runClosing(db, D1);
    return { db, root, x, kids };
  }

  it("pays renewal matching to X and 20% of it to X's sponsor", async () => {
    const { db, root, x, kids } = await renewalTeam();
    await recordPayment(db, { memberId: x.id, kind: "renewal", method: "online", date: D2, reference: "ren_x" });
    await recordPayment(db, { memberId: root.id, kind: "renewal", method: "offline", date: D2, reference: "cash", reason: "root", adminId: 1 });
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `ren_${k.code}` });
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "match_renewal")).toBe(rs(500));
    expect(await incomeOf(db, root.id, "sponsor")).toBe(rs(100));
  });

  it("no renewal income when the member's own subscription has lapsed", async () => {
    const { db, root, x, kids } = await renewalTeam();
    await db.query("update members set sub_valid_until = '2026-09-25' where id in ($1, $2)", [x.id, root.id]);
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `ren_${k.code}` });
    const r = await runClosing(db, D2);
    const line = r.lines.find((l) => l.member_id === x.id && l.bin === "renewal")!;
    expect(line.reason).toBe("own subscription not active");
    expect(await incomeOf(db, x.id, "match_renewal")).toBe(0);
    expect(await incomeOf(db, root.id, "sponsor")).toBe(0);
  });

  it("renewal extends the subscription from the end of the current period", async () => {
    const { db, x } = await renewalTeam();
    await recordPayment(db, { memberId: x.id, kind: "renewal", method: "online", date: D2, reference: "ren_x2" });
    const r = await db.query<{ v: string }>("select sub_valid_until::text as v from members where id = $1", [x.id]);
    expect(r[0].v).toBe("2026-11-30");
  });
});

describe("money safety", () => {
  it("a closing cannot run twice and a preview changes nothing", async () => {
    const { db, root } = await freshDb();
    await join(db, root.code, "L", { activate: D1 });
    const pv = await runClosing(db, D1, { preview: true });
    expect(pv.preview).toBe(true);
    expect(pv.summary.income.direct).toBe(rs(250));
    expect(await balance(db, root.id)).toBe(0);
    await runClosing(db, D1);
    await expect(runClosing(db, D1)).rejects.toThrow(/already posted/);
    expect(await balance(db, root.id)).toBe(rs(250));
  });

  it("closings must go in date order", async () => {
    const { db } = await freshDb();
    await runClosing(db, D2);
    await expect(runClosing(db, D1)).rejects.toThrow(/later closing/);
  });

  it("the wallet ledger cannot be edited", async () => {
    const { db, root } = await freshDb();
    await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);
    await expect(db.query("update ledger set amount_paise = 1")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from ledger")).rejects.toThrow(/append-only/);
  });

  it("refund before closing removes the BV", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L", { activate: D1 });
    const pay = await db.query<{ id: unknown }>("select id from payments where member_id = $1", [a.id]);
    await refundPayment(db, { paymentId: Number(pay[0].id), reason: "Customer cancelled", adminId: 1, date: D1 });
    const r = await runClosing(db, D1);
    expect(r.summary.events).toBe(0);
    expect(await incomeOf(db, root.id)).toBe(0);
    const m = await db.query<{ status: string }>("select status from members where id = $1", [a.id]);
    expect(m[0].status).toBe("red");
  });

  it("refund after closing claws back the Direct Sale Bonus and reverses the BV", async () => {
    const { db, root } = await freshDb();
    const a = await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);
    expect(await balance(db, root.id)).toBe(rs(250));
    const pay = await db.query<{ id: unknown }>("select id from payments where member_id = $1", [a.id]);
    await refundPayment(db, { paymentId: Number(pay[0].id), reason: "Chargeback", adminId: 1, date: D2 });
    expect(await balance(db, root.id)).toBe(0);
    await runClosing(db, D2);
    expect(await state(db, root.id, "new")).toMatchObject({ L: 0, R: 0 });
  });

  it("held income is recorded but not credited", async () => {
    const { db, root } = await freshDb();
    await db.query("update members set income_hold = true where id = $1", [root.id]);
    await join(db, root.code, "L", { activate: D1 });
    const r = await runClosing(db, D1);
    expect(r.summary.held).toBe(rs(250));
    expect(await balance(db, root.id)).toBe(0);
  });

  it("income held by an admin is released once the hold is taken off", async () => {
    const { db, root } = await freshDb();
    await db.query("update members set income_hold = true where id = $1", [root.id]);
    await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);
    expect(await balance(db, root.id)).toBe(0);

    await db.query("update members set income_hold = false where id = $1", [root.id]);
    await runClosing(db, D2);
    expect(await balance(db, root.id)).toBe(rs(250));
  });

  it("income stays held while the hold is still on", async () => {
    const { db, root } = await freshDb();
    await db.query("update members set income_hold = true where id = $1", [root.id]);
    await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);
    await runClosing(db, D2);
    expect(await balance(db, root.id)).toBe(0);
  });
});

describe("TDS", () => {
  it("starts when the year's income crosses the threshold, on the whole amount", async () => {
    const { db, root } = await freshDb({ tdsThresholdPaise: rs(400) });
    await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);                       // ₹250, below ₹400: no TDS
    expect(await balance(db, root.id)).toBe(rs(250));
    await join(db, root.code, "L", { activate: D2 });
    await runClosing(db, D2);                       // total ₹500 crosses: 20% (no PAN) on ₹500
    expect(await balance(db, root.id)).toBe(rs(500) - rs(100));
    await join(db, root.code, "L", { activate: D3 });
    await runClosing(db, D3);                       // already over: 20% on today's ₹250 only
    expect(await balance(db, root.id)).toBe(rs(750) - rs(150));
  });

  it("uses the lower rate when PAN is on file", async () => {
    const { db, root } = await freshDb({ tdsThresholdPaise: 0 });
    await db.query("update members set pan = 'ABCDE1234F' where id = $1", [root.id]);
    await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);
    expect(await balance(db, root.id)).toBe(rs(250) - rs(5));
  });
});

describe("red ID expiry", () => {
  it("removes only old, empty, unpaid Red IDs", async () => {
    const { removeExpiredReds } = await import("@/server/engine/members");
    const { istDate } = await import("@/server/engine/dates");
    const { db, root } = await freshDb();
    const paid = await join(db, root.code, "L", { activate: D1 });
    const lonely = await join(db, root.code, "L");           // placed under `paid`, nobody under it
    const parent = await join(db, root.code, "R");
    const child = await join(db, parent.code, "L");           // recent, so it stays
    await db.query("update members set created_at = now() - interval '40 days' where id in ($1, $2, $3)", [lonely.id, parent.id, paid.id]);
    const removed = await removeExpiredReds(db, istDate(), 30);
    expect(removed).toEqual([lonely.code]);
    expect(child.parentId).toBe(parent.id);
  });
});

describe("late and missed renewals", () => {
  async function team() {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { activate: D1, name: "Member X" });
    const kids = [await join(db, x.code, "L", { activate: D1 }), await join(db, x.code, "L", { activate: D1 }), await join(db, x.code, "R", { activate: D1 })];
    await runClosing(db, D1);
    return { db, root, x, kids };
  }

  it("keeps renewal income running during the 3-day grace", async () => {
    const { db, x, kids } = await team();
    await db.query("update members set sub_valid_until = '2026-09-29' where id = $1", [x.id]); // ended 3 days before D2
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `g_${k.code}` });
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "match_renewal")).toBe(rs(500));
  });

  it("stops renewal income one day after the grace", async () => {
    const { db, x, kids } = await team();
    await db.query("update members set sub_valid_until = '2026-09-28' where id = $1", [x.id]); // 4 days before D2
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `h_${k.code}` });
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "match_renewal")).toBe(0);
  });

  it("stops new-sale income after 90 days lapsed, but not before", async () => {
    const { db, x } = await team();
    await db.query("update members set sub_valid_until = '2026-07-04' where id = $1", [x.id]); // 90 days before D2
    await join(db, x.code, "R", { activate: D2 });
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "direct")).toBe(rs(1000)); // 3 on D1 + 1 on D2, still allowed at exactly 90 days
    await db.query("update members set sub_valid_until = '2026-07-03' where id = $1", [x.id]); // now 92 days before D3
    await join(db, x.code, "R", { activate: D3 });
    const r = await runClosing(db, D3);
    expect(await incomeOf(db, x.id, "direct")).toBe(rs(1000));
    expect(r.lines.find((l) => l.member_id === x.id && l.bin === "new")?.reason ?? "no pair").not.toBe(null);
  });
});

describe("₹2,499 plan (Sep 2026)", () => {
  const PLAN = {
    subscriptionBasePaise: 211780, gstBp: 1800, bvPerSubscription: 2500, pairBv: 2500, firstPairRatio: false,
    pairIncomePaise: 50000, dailyCapPaise: 500000, directBonusBp: 0, directBonusCredits: 21, sponsorBonusBp: 0,
    renewalGraceDays: 3, renewalGraceHold: true, lapseStopsNewDays: 0,
  };

  it("a refund stops the credits that were queued for that sale", async () => {
    const { db, root } = await freshDb(PLAN);
    const a = await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1);
    const queued = await db.query<{ ref: string; status: string }>("select ref, status from suite_credit_sync");
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("pending");

    const pay = await db.query<{ id: unknown }>("select id from payments where member_id = $1", [a.id]);
    await refundPayment(db, { paymentId: Number(pay[0].id), reason: "paid twice by mistake", adminId: 1, date: D2 });

    const after = await db.query<{ status: string; last_error: string | null }>("select status, last_error from suite_credit_sync");
    expect(after[0].status).toBe("done");
    expect(after[0].last_error).toMatch(/refunded/i);
  });

  it("charges ₹2,499, pays ₹500 on the first 1:1 pair and 21 credits (no cash) per direct sale", async () => {
    const { db, root } = await freshDb(PLAN);
    const a = await join(db, root.code, "L", { activate: D1 });
    await join(db, root.code, "R", { activate: D1 });
    await runClosing(db, D1);
    expect(await incomeOf(db, root.id, "match_new")).toBe(rs(500));
    expect(await incomeOf(db, root.id, "direct")).toBe(0);
    const q = await db.query<{ member_id: unknown; credits: unknown }>("select member_id, credits from suite_credit_sync");
    expect(q).toHaveLength(2);
    expect(q.every((r) => Number(r.member_id) === root.id && Number(r.credits) === 21)).toBe(true);
    const pay = await db.query<{ total_paise: unknown }>("select total_paise from payments where member_id = $1", [a.id]);
    expect(Number(pay[0].total_paise)).toBe(249900);
  });

  it("caps at 10 pairs a day and flushes the rest", async () => {
    const { db, root } = await freshDb(PLAN);
    for (let i = 0; i < 11; i++) { await join(db, root.code, "L", { activate: D1 }); await join(db, root.code, "R", { activate: D1 }); }
    const r = await runClosing(db, D1);
    expect(await incomeOf(db, root.id, "match_new")).toBe(rs(5000));
    const line = r.lines.find((l) => l.member_id === root.id && l.bin === "new")!;
    expect(line.paid_pairs).toBe(10);
    expect(line.flushed_pairs).toBe(1);
  });

  it("a preview queues no credits", async () => {
    const { db, root } = await freshDb(PLAN);
    await join(db, root.code, "L", { activate: D1 });
    await runClosing(db, D1, { preview: true });
    expect(await db.query("select 1 from suite_credit_sync")).toHaveLength(0);
  });

  async function team() {
    const { db, root } = await freshDb(PLAN);
    const x = await join(db, root.code, "L", { activate: D1, name: "Member X" });
    const kids = [await join(db, x.code, "L", { activate: D1 }), await join(db, x.code, "R", { activate: D1 })];
    await runClosing(db, D1);
    return { db, root, x, kids };
  }

  it("no sponsor bonus on renewal matching", async () => {
    const { db, root, kids, x } = await team();
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `r_${k.code}` });
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "match_renewal")).toBe(rs(500));
    expect(await incomeOf(db, root.id, "sponsor")).toBe(0);
  });

  it("holds renewal income in the grace days and pays it when the member renews in time", async () => {
    const { db, x, kids } = await team();
    await db.query("update members set sub_valid_until = '2026-10-01' where id = $1", [x.id]); // ended the day before D2
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `r_${k.code}` });
    await runClosing(db, D2);
    const before = await balance(db, x.id);
    expect(await incomeOf(db, x.id, "match_renewal")).toBe(rs(500));
    await recordPayment(db, { memberId: x.id, kind: "renewal", method: "online", date: D3, reference: "r_x" });
    const r = await runClosing(db, D3);
    expect(r.summary.grace?.released).toBe(rs(500));
    expect(await balance(db, x.id)).toBeGreaterThan(before);
  });

  it("forfeits held renewal income when the member does not renew within the grace days", async () => {
    const { db, x, kids } = await team();
    await db.query("update members set sub_valid_until = '2026-10-01' where id = $1", [x.id]);
    for (const k of kids) await recordPayment(db, { memberId: k.id, kind: "renewal", method: "online", date: D2, reference: `r_${k.code}` });
    await runClosing(db, D2);
    const bal = await balance(db, x.id);
    await runClosing(db, D3);
    await runClosing(db, "2026-10-04");
    const r = await runClosing(db, "2026-10-05");            // grace (2–4 Oct) is over
    expect(r.summary.grace?.forfeited).toBe(rs(500));
    expect(await balance(db, x.id)).toBe(bal);
  });

  it("new-sale income needs no active subscription once the ID is green", async () => {
    const { db, x } = await team();
    await db.query("update members set sub_valid_until = '2026-06-01' where id = $1", [x.id]); // lapsed months ago
    await join(db, x.code, "L", { activate: D2 });
    await join(db, x.code, "R", { activate: D2 });
    await runClosing(db, D2);
    expect(await incomeOf(db, x.id, "match_new")).toBe(rs(1000));
  });
});
