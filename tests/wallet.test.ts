import { describe, expect, it } from "vitest";
import { runClosing } from "@/server/engine/closing";
import { adjustWallet, available, decideWithdrawal, requestWithdrawal } from "@/server/engine/wallet";
import { balance, freshDb, join, rs } from "./helpers";

const D1 = "2026-10-01";

async function earner() {
  const { db, root } = await freshDb({ minWithdrawalPaise: rs(100) });
  for (let i = 0; i < 4; i++) await join(db, root.code, "L", { activate: D1 });
  await runClosing(db, D1); // ₹1,000 Direct Sale Bonus
  return { db, root };
}
const approveKyc = (db: Awaited<ReturnType<typeof freshDb>>["db"], id: number) => db.query(
  `insert into kyc (member_id, pan, pan_name, bank_name, account_name, account_no, ifsc, status)
   values ($1, 'ABCDE1234F', 'Company', 'SBI', 'Company', '123456789', 'SBIN0001234', 'approved')`, [id]);

describe("withdrawals", () => {
  it("needs approved KYC", async () => {
    const { db, root } = await earner();
    await expect(requestWithdrawal(db, root.id, rs(500), D1)).rejects.toThrow(/KYC/);
  });

  it("respects the minimum and the available balance", async () => {
    const { db, root } = await earner();
    await approveKyc(db, root.id);
    await expect(requestWithdrawal(db, root.id, rs(50), D1)).rejects.toThrow(/minimum/);
    await expect(requestWithdrawal(db, root.id, rs(1500), D1)).rejects.toThrow(/more than your available/);
  });

  it("reserves the amount on request and debits it only when paid", async () => {
    const { db, root } = await earner();
    await approveKyc(db, root.id);
    const id = await requestWithdrawal(db, root.id, rs(600), D1);
    expect(await available(db, root.id)).toBe(rs(400));
    expect(await balance(db, root.id)).toBe(rs(1000));
    await expect(requestWithdrawal(db, root.id, rs(500), D1)).rejects.toThrow(/more than your available/);
    await decideWithdrawal(db, { id, adminId: 1, action: "paid", utr: "UTR1", date: D1 });
    expect(await balance(db, root.id)).toBe(rs(400));
    await expect(decideWithdrawal(db, { id, adminId: 1, action: "paid", utr: "UTR2", date: D1 })).rejects.toThrow(/not pending/);
  });

  it("a rejected request returns the amount", async () => {
    const { db, root } = await earner();
    await approveKyc(db, root.id);
    const id = await requestWithdrawal(db, root.id, rs(600), D1);
    await decideWithdrawal(db, { id, adminId: 1, action: "reject", reason: "Bank details wrong", date: D1 });
    expect(await available(db, root.id)).toBe(rs(1000));
  });

  it("blocked withdrawals are refused", async () => {
    const { db, root } = await earner();
    await approveKyc(db, root.id);
    await db.query("update members set withdraw_block = true where id = $1", [root.id]);
    await expect(requestWithdrawal(db, root.id, rs(500), D1)).rejects.toThrow(/on hold/);
  });

  it("manual adjustments need a note and land in the ledger", async () => {
    const { db, root } = await earner();
    await expect(adjustWallet(db, { memberId: root.id, amountPaise: rs(50), note: "", adminId: 1, date: D1 })).rejects.toThrow(/note/);
    await adjustWallet(db, { memberId: root.id, amountPaise: -rs(50), note: "Correction", adminId: 1, date: D1 });
    expect(await balance(db, root.id)).toBe(rs(950));
  });
});
