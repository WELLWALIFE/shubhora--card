import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMember } from "@/server/engine/members";
import { ensureSuiteUser } from "@/server/suite";
import { freshDb } from "./helpers";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const one = async (db: Awaited<ReturnType<typeof freshDb>>["db"], sql: string, p: unknown[]) => (await db.query<Record<string, unknown>>(sql, p))[0];

describe("one person, one ID: nothing is linked through a matching email or mobile", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("a second ID with the same email is refused, naming the first ID", async () => {
    const { db, root } = await freshDb();
    const a = await registerMember(db, { sponsorCode: root.code, leg: "L", name: "Niteen Rajput", mobile: "9800000001", email: "niteen@example.com", password: "password123" });
    await expect(registerMember(db, { sponsorCode: root.code, leg: "R", name: "Niteen R", mobile: "9800000002", email: "NITEEN@example.com", password: "password123" }))
      .rejects.toThrow(new RegExp(`email already has an ID \\(${a.code}\\)`));
    await expect(registerMember(db, { sponsorCode: root.code, leg: "R", name: "Niteen R", mobile: "9800000001", password: "password123" }))
      .rejects.toThrow(new RegExp(`mobile number already has an ID \\(${a.code}\\)`));
  });

  it("an app sign-up is tied by its account id only", async () => {
    const { db, root } = await freshDb();
    await registerMember(db, { sponsorCode: root.code, leg: "L", name: "Panel Person", mobile: "9800000003", email: "same@example.com", password: "password123" });
    const b = await registerMember(db, { sponsorCode: root.code, leg: "R", name: "App Person", email: "same@example.com", suiteUserId: U1 });
    expect((await one(db, "select suite_user_id from members where id = $1", [b.id])).suite_user_id).toBe(U1);
  });

  it("an existing app account with the ID's email is never taken over", async () => {
    vi.stubEnv("SUITE_LINK_URL", "http://suite.test/api/link"); vi.stubEnv("SUITE_LINK_SECRET", "s");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body).action);
      return new Response(JSON.stringify({ userId: U2, created: false }), { status: 200 });
    }));
    const { db, root } = await freshDb();
    const x = await registerMember(db, { sponsorCode: root.code, leg: "L", name: "Staff Made", mobile: "9800000004", email: "old@example.com", password: "password123" });
    await expect(ensureSuiteUser(db, x.id)).rejects.toThrow(/not linked to it automatically/);
    expect((await one(db, "select suite_user_id from members where id = $1", [x.id])).suite_user_id).toBeNull();
    expect(calls).toEqual(["ensure"]);
  });

  it("an email that is already another ID's app login is not even looked up", async () => {
    vi.stubEnv("SUITE_LINK_URL", "http://suite.test/api/link"); vi.stubEnv("SUITE_LINK_SECRET", "s");
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const { db, root } = await freshDb();
    const a = await registerMember(db, { sponsorCode: root.code, leg: "L", name: "First", email: "twin@example.com", suiteUserId: U1 });
    const b = await registerMember(db, { sponsorCode: root.code, leg: "R", name: "Second", mobile: "9800000005", password: "password123" });
    await db.query("update members set email = 'twin@example.com' where id = $1", [b.id]); // an old record from before the rule
    await expect(ensureSuiteUser(db, b.id)).rejects.toThrow(new RegExp(`app login of ${a.code}`));
    expect(f).not.toHaveBeenCalled();
  });

  it("a new account made for the ID is linked", async () => {
    vi.stubEnv("SUITE_LINK_URL", "http://suite.test/api/link"); vi.stubEnv("SUITE_LINK_SECRET", "s");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ userId: U2, created: true }), { status: 200 })));
    const { db, root } = await freshDb();
    const x = await registerMember(db, { sponsorCode: root.code, leg: "L", name: "Fresh One", mobile: "9800000006", email: "fresh@example.com", password: "password123" });
    expect(await ensureSuiteUser(db, x.id)).toBe(U2);
    expect((await one(db, "select suite_user_id from members where id = $1", [x.id])).suite_user_id).toBe(U2);
  });
});
