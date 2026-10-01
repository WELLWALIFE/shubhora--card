import { type Db, maybeOne, n, one } from "../db";
import { hashPassword } from "../auth/password";

export type Leg = "L" | "R";

export class RuleError extends Error {
  constructor(message: string) { super(message); this.name = "RuleError"; }
}

const PLACEMENT_LOCK = 7_140_001;

export async function memberByCode(db: Db, code: string) {
  return maybeOne<{ id: unknown; code: string; status: string; parent_id: unknown }>(
    // An exact SH code wins over a username that happens to read the same (owner's review, 28 Sep 2026).
    db, "select id, code, status, parent_id from members where upper(code) = upper($1) or lower(username) = lower($1) order by (upper(code) = upper($1)) desc limit 1", [code.trim()],
  );
}

/** A member by the name people actually share: the app username, or the older SH code. */
export async function memberByHandle(db: Db, handle: string) {
  const h = handle.trim();
  if (!h) return null;
  return maybeOne<{ id: unknown; code: string; username: string | null; status: string; suite_user_id: string | null; name: string }>(
    db, "select id, code, username, status, suite_user_id, name from members where lower(username) = lower($1) or upper(code) = upper($1) order by (upper(code) = upper($1)) desc limit 1", [h],
  );
}

export async function memberBySuiteUser(db: Db, suiteUserId: string) {
  return maybeOne<{ id: unknown; code: string; username: string | null; status: string; sub_valid_until: string | null; blocked: boolean }>(
    db, "select id, code, username, status, sub_valid_until::text, blocked from members where suite_user_id = $1", [suiteUserId],
  );
}

/** The company's top ID (the only member with no placement parent). */
export async function rootMember(db: Db) {
  return one<{ id: unknown; code: string }>(db, "select id, code from members where parent_id is null limit 1");
}

/** The side of `sponsorId`'s team with fewer members — where an app sign-up is placed when nobody chose a side. */
export async function weakerLeg(db: Db, sponsorId: number): Promise<Leg> {
  const rows = await db.query<{ side: string; c: unknown }>(
    `with recursive down as (
       select id, leg as side from members where parent_id = $1
       union all
       select m.id, down.side from members m join down on m.parent_id = down.id
     ) select side, count(*) as c from down group by side`, [sponsorId]);
  const l = n(rows.find((r) => r.side === "L")?.c), r = n(rows.find((r) => r.side === "R")?.c);
  return r < l ? "R" : "L";
}

/** Where a sign-up from the universal link (the card's) goes (owner's call, 24 Sep 2026): binary income needs one
 *  own direct on the LEFT and one on the RIGHT, so those are filled first — left, then right — and only then the
 *  weaker side. Spill-over from above does not count as the sponsor's own direct. */
export async function autoLeg(db: Db, sponsorId: number): Promise<Leg> {
  const rows = await db.query<{ side: string; c: unknown }>(
    `with recursive down as (
       select id, sponsor_id, leg as side from members where parent_id = $1
       union all
       select m.id, m.sponsor_id, down.side from members m join down on m.parent_id = down.id
     ) select side, count(*) as c from down where sponsor_id = $1 group by side`, [sponsorId]);
  const l = n(rows.find((r) => r.side === "L")?.c), r = n(rows.find((r) => r.side === "R")?.c);
  if (l === 0) return "L";
  if (r === 0) return "R";
  return weakerLeg(db, sponsorId);
}

/** The company's own top ID. Created once, green, with no placement parent. */
/** The company's own ID at the top of the tree. `greenDate` exists for the tests, which close on fixed dates:
 *  with the real today the root is not yet green on those dates and earns nothing, so the suite passed only on
 *  the day it was written. Production leaves it out and the root is green from today. */
export async function createRoot(db: Db, p: { name: string; mobile: string; password: string; codePrefix?: string; greenDate?: string }) {
  const hash = await hashPassword(p.password);
  return db.tx(async (t) => {
    const row = await one<{ id: unknown; code: string }>(t,
      `insert into members (code, name, mobile, password_hash, status, green_kind, green_at, green_date, depth)
       values ($1 || nextval('member_code_seq')::text, $2, $3, $4, 'green', 'complimentary', now(), coalesce($5::date, current_date), 0)
       returning id, code`,
      [p.codePrefix ?? "SH", p.name, p.mobile, hash, p.greenDate ?? null]);
    return { id: n(row.id), code: row.code };
  });
}

/** Bottom of one leg, following only that leg from `fromId` (extreme left / extreme right). */
async function extremeSlot(db: Db, fromId: number, leg: Leg): Promise<number> {
  const row = await one<{ id: unknown }>(db,
    `with recursive chain as (
       select id, 0 as step from members where id = $1
       union all
       select m.id, c.step + 1 from members m join chain c on m.parent_id = c.id and m.leg = $2
     ) select id from chain order by step desc limit 1`,
    [fromId, leg]);
  return n(row.id);
}

async function isInDownlineOrSelf(db: Db, ancestorId: number, nodeId: number): Promise<boolean> {
  const row = await one<{ ok: boolean }>(db,
    `with recursive up as (
       select id, parent_id from members where id = $2
       union all
       select m.id, m.parent_id from members m join up on m.id = up.parent_id
     ) select exists (select 1 from up where id = $1) as ok`,
    [ancestorId, nodeId]);
  return !!row.ok;
}

export type RegisterInput = {
  /** The sponsor by SH code — or `sponsorId` when the caller already knows the row (app sign-ups). */
  sponsorCode?: string;
  sponsorId?: number;
  /** "auto" (the universal link): the sponsor's first own direct left, the next right, then the weaker side (see autoLeg). */
  leg: Leg | "auto";
  /** Optional exact position: this member's `leg` slot must be empty and inside the sponsor's team. */
  parentCode?: string;
  name: string;
  /** Optional for app sign-ups (a Google account may add its number later). */
  mobile?: string;
  email?: string;
  /** Optional for app sign-ups — they log in through the app; a random secret is stored. */
  password?: string;
  codePrefix?: string;
  /** App sign-ups carry their app username and account id; the username is the partner's public name. */
  username?: string;
  dob?: string;
  gender?: "male" | "female" | "other";
  agreedAt?: string;
  suiteUserId?: string;
};

/** Free registration: creates a Red ID placed in the sponsor's chosen leg (or the weaker one). */
export async function registerMember(db: Db, p: RegisterInput): Promise<{ id: number; code: string; parentId: number; leg: Leg }> {
  const mobile = (p.mobile ?? "").replace(/\D/g, "").slice(-10);
  if (p.mobile && mobile.length !== 10) throw new RuleError("Enter a valid 10-digit mobile number.");
  if (!p.mobile && !p.suiteUserId) throw new RuleError("Enter a valid 10-digit mobile number.");
  if (p.name.trim().length < 2) throw new RuleError("Enter the member's full name.");
  if (p.password !== undefined && p.password.length < 8) throw new RuleError("Password must be at least 8 characters.");
  const hash = await hashPassword(p.password ?? randomSecret());
  // A username shaped like an ID (SH100245) is never stored: it could be mistaken for that partner's code. The ID is still
  // created — only the name is left empty (owner's review, 28 Sep 2026).
  const asked = p.username?.trim() || null;
  const username = asked && !/^[A-Za-z]{2}\d{4,}$/.test(asked) ? asked : null;
  if (username && !/^[A-Za-z0-9_]{4,20}$/.test(username)) throw new RuleError("Username: 4–20 letters, numbers or _.");

  return db.tx(async (t) => {
    await t.query("select pg_advisory_xact_lock($1)", [PLACEMENT_LOCK]);
    const sponsor = p.sponsorId
      ? await maybeOne<{ id: unknown; code: string; status: string; parent_id: unknown }>(t, "select id, code, status, parent_id from members where id = $1", [p.sponsorId])
      : await memberByCode(t, p.sponsorCode ?? "");
    if (!sponsor) throw new RuleError("Sponsor ID not found.");
    const sponsorId = n(sponsor.id);
    // One mobile / one email ↔ one ID. The SH code is the identity; a second ID never shares these with the first,
    // so nothing can ever be matched (and mixed) through them. App sign-ups skip the email check: their email is
    // their own app account's, and the account id — not the email — is what ties them to this ID.
    if (mobile) {
      const dup = await maybeOne<{ code: string }>(t, "select code from members where mobile = $1", [mobile]);
      if (dup) throw new RuleError(`This mobile number already has an ID (${dup.code}).`);
    }
    const email = p.email?.trim().toLowerCase() || "";
    if (email && !p.suiteUserId) {
      const dupE = await maybeOne<{ code: string }>(t, "select code from members where lower(email) = $1 limit 1", [email]);
      if (dupE) throw new RuleError(`This email already has an ID (${dupE.code}). Use a different email — one email, one ID.`);
    }
    if (username) {
      const dupU = await maybeOne(t, "select 1 from members where lower(username) = lower($1)", [username]);
      if (dupU) throw new RuleError("This username already has an ID.");
    }
    if (p.suiteUserId) {
      const dupS = await maybeOne<{ id: unknown; code: string; parent_id: unknown; leg: Leg }>(t, "select id, code, parent_id, leg from members where suite_user_id = $1", [p.suiteUserId]);
      if (dupS) return { id: n(dupS.id), code: dupS.code, parentId: n(dupS.parent_id), leg: dupS.leg }; // already registered: idempotent
    }
    const leg: Leg = p.leg === "auto" ? await autoLeg(t, sponsorId) : p.leg;

    let parentId: number;
    if (p.parentCode) {
      const parent = await memberByCode(t, p.parentCode);
      if (!parent) throw new RuleError("Placement ID not found.");
      parentId = n(parent.id);
      if (!(await isInDownlineOrSelf(t, sponsorId, parentId)))
        throw new RuleError("The placement ID must be in the sponsor's own team.");
      const taken = await maybeOne(t, "select 1 from members where parent_id = $1 and leg = $2", [parentId, leg]);
      if (taken) throw new RuleError(`The ${leg === "L" ? "left" : "right"} position under ${parent.code} is already filled.`);
    } else {
      parentId = await extremeSlot(t, sponsorId, leg);
    }

    const row = await one<{ id: unknown; code: string }>(t,
      `insert into members (code, name, mobile, email, password_hash, sponsor_id, parent_id, leg, depth, username, suite_user_id, suite_email, suite_origin, dob, gender, agreed_at)
       select $1 || nextval('member_code_seq')::text, $2, $3, $4, $5, $6, $7, $8, depth + 1, $9, $10, $11, $12, $13, $14, $15
       from members where id = $7
       returning id, code`,
      [p.codePrefix ?? "SH", p.name.trim(), mobile || null, p.email?.trim() || null, hash, sponsorId, parentId, leg,
       username, p.suiteUserId ?? null, p.suiteUserId ? (p.email?.trim().toLowerCase() || null) : null, !!p.suiteUserId,
       /^\d{4}-\d{2}-\d{2}$/.test(p.dob ?? "") ? p.dob : null, p.gender ?? null, p.agreedAt ?? null]);
    return { id: n(row.id), code: row.code, parentId, leg };
  });
}

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

/** Remove Red IDs older than `days` that never paid and have nobody under them (placement or sponsorship)
 *  and no records attached. Keeps the tree clean. Returns the removed codes. */
export async function removeExpiredReds(db: Db, today: string, days: number): Promise<string[]> {
  if (days <= 0) return [];
  return db.tx(async (t) => {
    await t.query("select pg_advisory_xact_lock($1)", [PLACEMENT_LOCK]);
    const rows = await t.query<{ id: unknown; code: string }>(
      `select m.id, m.code from members m
       where m.status = 'red' and m.parent_id is not null and m.created_at < ($1::date - $2::int)
         and not exists (select 1 from members c where c.parent_id = m.id or c.sponsor_id = m.id)
         and not exists (select 1 from payments p where p.member_id = m.id)
         and not exists (select 1 from pay_orders o where o.member_id = m.id)
         and not exists (select 1 from audit_log a where a.member_id = m.id)
         and not exists (select 1 from kyc k where k.member_id = m.id)
         and not exists (select 1 from tickets k where k.member_id = m.id)
         and not exists (select 1 from ledger l where l.member_id = m.id)
         and not exists (select 1 from bv_events e where e.member_id = m.id)
         and not exists (select 1 from binary_state b where b.member_id = m.id)
         and not exists (select 1 from closing_lines cl where cl.member_id = m.id)`, [today, days]);
    if (!rows.length) return [];
    const ids = rows.map((r) => n(r.id));
    await t.query("delete from sessions where kind = 'member' and subject_id = any($1::bigint[])", [ids]);
    await t.query("delete from members where id = any($1::bigint[])", [ids]);
    return rows.map((r) => r.code);
  });
}
