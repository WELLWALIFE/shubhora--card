import { describe, expect, it } from "vitest";
import { recordPayment, refundPayment } from "@/server/engine/payments";
import { runClosing } from "@/server/engine/closing";
import { freshDb, join, rs } from "./helpers";

const D = "2026-10-01";
const one = async (db: Awaited<ReturnType<typeof freshDb>>["db"], sql: string, p: unknown[]) => (await db.query<Record<string, unknown>>(sql, p))[0];

describe("admin activations on any terms", () => {
  it("free entry with 0 BV: green, no invoice, no BV", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Leader One" });
    const r = await recordPayment(db, { memberId: x.id, kind: "activation", method: "complimentary", date: D, reason: "leader", adminId: 1, bv: 0, adminMode: "free-0bv" });
    expect(r.invoiceNo).toBeNull();
    expect((await one(db, "select status, green_kind from members where id = $1", [x.id]))).toMatchObject({ status: "green", green_kind: "complimentary" });
    expect(Number((await one(db, "select count(*) c from bv_events where member_id = $1", [x.id])).c)).toBe(0);
  });

  it("free entry with full BV: BV goes up the tree and the sponsor earns the direct bonus", async () => {
    const { db, root } = await freshDb({ tdsThresholdPaise: rs(1_000_000) });
    const s = await join(db, root.code, "L", { name: "Sponsor S", activate: D });
    const x = await join(db, s.code, "L", { name: "Leader Two" });
    await recordPayment(db, { memberId: x.id, kind: "activation", method: "complimentary", date: D, reason: "leader", adminId: 1, bv: 2500, adminMode: "free-full-bv" });
    const ev = await one(db, "select bin, bv from bv_events where member_id = $1", [x.id]);
    expect(ev).toMatchObject({ bin: "new" });
    expect(Number(ev.bv)).toBe(2500);
    await runClosing(db, D);
    const direct = await one(db, "select coalesce(sum(gross_paise),0) g from incomes where member_id = $1 and kind = 'direct'", [s.id]);
    expect(Number(direct.g)).toBeGreaterThan(0);
  });

  it("part payment with part BV, 3 months, no app plan — and refund reverses it", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "R", { name: "Part Payer" });
    const r = await recordPayment(db, { memberId: x.id, kind: "activation", method: "offline", date: D, reference: "UTR123", reason: "discount", adminId: 1,
      totalPaise: rs(1500), bv: 1250, months: 3, appPlan: false, adminMode: "paid-part" });
    expect(r.invoiceNo).toBeTruthy();
    const p = await one(db, "select total_paise, bv_given, months, app_plan, period_to::text as till from payments where id = $1", [r.paymentId]);
    expect(Number(p.total_paise)).toBe(rs(1500));
    expect(Number(p.bv_given)).toBe(1250);
    expect(Number(p.months)).toBe(3);
    expect(p.app_plan).toBe(false);
    expect(p.till).toBe("2026-12-31");
    expect((await one(db, "select status from suite_sync where payment_id = $1", [r.paymentId])).status).toBe("done");
    await refundPayment(db, { paymentId: r.paymentId, reason: "mistake", adminId: 1, date: D });
    expect((await one(db, "select status from members where id = $1", [x.id])).status).toBe("red");
  });

  it("the normal paid path is unchanged: full plan BV by default", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Normal Payer" });
    await recordPayment(db, { memberId: x.id, kind: "activation", method: "online", date: D, reference: "pay_1" });
    expect(Number((await one(db, "select bv from bv_events where member_id = $1", [x.id])).bv)).toBe(2500);
  });
});

describe("offline payments entered twice", () => {
  it("the same reference on the same day is one payment, not two", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Twice Over" });
    const first = await recordPayment(db, { memberId: x.id, kind: "activation", method: "offline", date: D, reference: "NEFT-77", reason: "bank transfer", adminId: 1 });
    const again = await recordPayment(db, { memberId: x.id, kind: "activation", method: "offline", date: D, reference: "neft-77", reason: "bank transfer", adminId: 1 });

    expect(again.duplicate).toBe(true);
    expect(again.paymentId).toBe(first.paymentId);
    expect(Number((await one(db, "select count(*) c from payments where member_id = $1", [x.id])).c)).toBe(1);
    expect(Number((await one(db, "select coalesce(sum(bv),0) b from bv_events where member_id = $1", [x.id])).b)).toBe(2500);
  });

  it("the same reference on a later day is a real second payment", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Monthly Cash" });
    await recordPayment(db, { memberId: x.id, kind: "activation", method: "offline", date: D, reference: "CASH", reason: "counter", adminId: 1 });
    const next = await recordPayment(db, { memberId: x.id, kind: "renewal", method: "offline", date: "2026-11-02", reference: "CASH", reason: "counter", adminId: 1 });

    expect(next.duplicate).toBe(false);
    expect(Number((await one(db, "select count(*) c from payments where member_id = $1", [x.id])).c)).toBe(2);
  });
});
