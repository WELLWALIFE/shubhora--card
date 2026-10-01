import { describe, expect, it } from "vitest";
import { approvePaymentRequest, recordPayment } from "@/server/engine/payments";
import { freshDb, join } from "./helpers";

const D = "2026-10-01";
const one = async (db: Awaited<ReturnType<typeof freshDb>>["db"], sql: string, p: unknown[]) => (await db.query<Record<string, unknown>>(sql, p))[0];
const num = (v: unknown) => Number(v ?? 0);

/** A member with a pending manual payment request. */
async function pending(db: Awaited<ReturnType<typeof freshDb>>["db"], memberId: number, reference: string) {
  const r = await one(db, `insert into payment_requests (member_id, submitted_by, kind, amount_paise, method, reference, paid_on)
    values ($1, $1, 'activation', 299900, 'upi', $2, $3) returning id`, [memberId, reference, D]);
  return Number(r.id);
}

describe("manual payment requests", () => {
  it("approving once turns the ID green and writes one payment", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Member One" });
    const rid = await pending(db, x.id, "UPI-1");

    const out = await approvePaymentRequest(db, { requestId: rid, adminId: 1, date: D });

    expect(out.kind).toBe("activation");
    expect((await one(db, "select status from members where id = $1", [x.id])).status).toBe("green");
    expect(num((await one(db, "select count(*) c from payments where member_id = $1", [x.id])).c)).toBe(1);
    const req = await one(db, "select status, payment_id, decided_by from payment_requests where id = $1", [rid]);
    expect(req.status).toBe("approved");
    expect(num(req.payment_id)).toBe(out.paymentId);
    expect(num(req.decided_by)).toBe(1);
  });

  it("a second approval of the same request applies nothing — no extra month, no extra BV", async () => {
    const { db, root } = await freshDb();
    const s = await join(db, root.code, "L", { name: "Sponsor", activate: D });
    const x = await join(db, s.code, "L", { name: "Member Two" });
    const rid = await pending(db, x.id, "UPI-2");

    await approvePaymentRequest(db, { requestId: rid, adminId: 1, date: D });
    const after = await one(db, "select sub_valid_until::text v from members where id = $1", [x.id]);
    const bv = num((await one(db, "select coalesce(sum(bv),0) b from bv_events where member_id = $1", [x.id])).b);

    await expect(approvePaymentRequest(db, { requestId: rid, adminId: 1, date: D })).rejects.toThrow(/no longer pending/i);

    expect(num((await one(db, "select count(*) c from payments where member_id = $1", [x.id])).c)).toBe(1);
    expect((await one(db, "select sub_valid_until::text v from members where id = $1", [x.id])).v).toBe(after.v);
    expect(num((await one(db, "select coalesce(sum(bv),0) b from bv_events where member_id = $1", [x.id])).b)).toBe(bv);
  });

  it("a renewal request on a green ID is approved as a renewal", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Member Three" });
    await recordPayment(db, { memberId: x.id, kind: "activation", method: "offline", date: D, reference: "CASH-1", reason: "first", adminId: 1 });
    const rid = await pending(db, x.id, "UPI-3");

    const out = await approvePaymentRequest(db, { requestId: rid, adminId: 1, date: D });

    expect(out.kind).toBe("renewal");
    expect(num((await one(db, "select count(*) c from payments where member_id = $1", [x.id])).c)).toBe(2);
  });

  it("a rejected request cannot be approved afterwards", async () => {
    const { db, root } = await freshDb();
    const x = await join(db, root.code, "L", { name: "Member Four" });
    const rid = await pending(db, x.id, "UPI-4");
    await db.query("update payment_requests set status = 'rejected', reject_reason = 'blurred proof' where id = $1", [rid]);

    await expect(approvePaymentRequest(db, { requestId: rid, adminId: 1, date: D })).rejects.toThrow(/no longer pending/i);
    expect(num((await one(db, "select count(*) c from payments where member_id = $1", [x.id])).c)).toBe(0);
  });
});
