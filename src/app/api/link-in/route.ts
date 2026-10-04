import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/server";
import { maybeOne, n, one } from "@/server/db";
import { memberByHandle, memberBySuiteUser, registerMember, rootMember, RuleError } from "@/server/engine/members";
import { recordPayment } from "@/server/engine/payments";
import { istDate } from "@/server/engine/dates";
import { incomeTotals, rankInfo, subscriptionHistory, teamCounts, walletBalance, flags } from "@/server/queries";

// Called server-to-server by the Shubhora app. The body is signed with the shared link secret.
// One account = one partner account (from 22 Sep 2026): the app creates the account, then tells us.
//   (no action) → a one-time sign-in address for "Partner panel" in the app (the original use)
//   resolve     → who a username / SH code is (the introducer shown on the app's sign-up)
//   register    → the new account's partner ID, placed automatically under its introducer (weaker side)
//   summary     → the Me page strip: status, team, wallet
//   dashboard   → the app's Business page: everything the overview shows, handles only (usernames / codes), no names
//   paid        → a subscription paid inside the app: activation or renewal + the plan's BV, no second grant
//   members     → Super Admin's user list: every partner ID (root included) with sponsor, placement and status
//   member / member_update → Super Admin's user profile: read / edit the partner record of an app account
//   staff       → Super Admin's Staff page: list / create / update / reset / reset2fa / logout / activity of Staff Admin logins
const PUBLIC = () => (process.env.PUBLIC_URL || "https://neuraledge.me/partners").replace(/\/$/, "");

function signatureOk(raw: string, sig: string) {
  const secret = process.env.SUITE_LINK_SECRET ?? "";
  if (!secret || !sig) return false;
  const want = createHmac("sha256", secret).update(raw).digest("hex");
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

const UUID = /^[0-9a-f-]{36}$/i;
const S = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-link-signature") ?? "")) return Response.json({ error: "bad signature" }, { status: 401 });
  const b = JSON.parse(raw) as Record<string, unknown>;
  if (Math.abs(Date.now() - Number(b.ts ?? 0)) > 5 * 60_000) return Response.json({ error: "stale request" }, { status: 401 });
  const d = await db();

  try {
    if (b.action === "resolve") {
      const m = await memberByHandle(d, S(b.handle, 40));
      if (!m) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ code: m.code, username: m.username, suiteUserId: m.suite_user_id, status: m.status });
    }

    if (b.action === "register") {
      const suiteUserId = S(b.suiteUserId, 36);
      if (!UUID.test(suiteUserId)) return Response.json({ error: "bad user" }, { status: 400 });
      const existing = await memberBySuiteUser(d, suiteUserId);
      if (existing) {
        // Idempotent; an account that picked its username after registering gets it stamped now.
        const username = S(b.username, 20);
        // Never a username shaped like an ID (SH100245) — it could be mistaken for that partner's code.
        if (username && !existing.username && !/^[A-Za-z]{2}\d{4,}$/.test(username)) await d.query("update members set username = $2 where id = $1 and username is null and not exists (select 1 from members where lower(username) = lower($2))", [n(existing.id), username]);
        return Response.json({ code: existing.code, username: existing.username ?? (username || null), status: existing.status, existing: true });
      }
      // The introducer: by their account id first (an app account), then by username / SH code, else the company.
      let sponsorId: number | null = null;
      const by = S(b.introducerSuiteUserId, 36);
      if (UUID.test(by)) sponsorId = n((await memberBySuiteUser(d, by))?.id) || null;
      if (!sponsorId && S(b.introducer, 40)) sponsorId = n((await memberByHandle(d, S(b.introducer, 40)))?.id) || null;
      if (!sponsorId) sponsorId = n((await rootMember(d)).id);
      // The link's side (Grow page: separate left / right links); the card's universal link sends nothing → weaker side.
      const leg = S(b.leg, 1).toUpperCase() === "L" ? "L" : S(b.leg, 1).toUpperCase() === "R" ? "R" : "auto";
      const r = await registerMember(d, {
        sponsorId, leg, name: S(b.name, 80) || "Shubhora member", mobile: S(b.mobile, 15) || undefined,
        email: S(b.email, 120) || undefined, username: S(b.username, 20) || undefined, suiteUserId,
        dob: S(b.dob, 10) || undefined, gender: (["male", "female", "other"] as const).find((g) => g === S(b.gender, 10)),
        agreedAt: S(b.agreedAt, 40) || undefined,
        codePrefix: process.env.ID_PREFIX || "SH",
      });
      return Response.json({ code: r.code, username: S(b.username, 20) || null, status: "red", leg: r.leg });
    }

    if (b.action === "summary") {
      const suiteUserId = S(b.suiteUserId, 36);
      if (!UUID.test(suiteUserId)) return Response.json({ error: "bad user" }, { status: 400 });
      const m = await memberBySuiteUser(d, suiteUserId);
      if (!m) return Response.json({ error: "no partner account" }, { status: 404 });
      const id = n(m.id);
      const [team, wallet, due, today] = await Promise.all([
        teamCounts(id), walletBalance(id),
        one<{ c: unknown }>(d, "select count(*) as c from members where sponsor_id = $1 and status = 'green' and sub_valid_until is not null and sub_valid_until <= current_date + 7", [id]),
        // Joined today (India time), anywhere in this member's downline — the Home page strip (owner's call, 28 Sep 2026).
        one<{ c: unknown }>(d, `with recursive down as (select id from members where parent_id = $1 union all select m.id from members m join down on m.parent_id = down.id)
          select count(*) as c from down d join members m on m.id = d.id where (m.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`, [id]),
      ]);
      return Response.json({
        code: m.code, username: m.username, status: m.status, subValidUntil: m.sub_valid_until,
        team: team.left + team.right, teamGreen: team.leftGreen + team.rightGreen, teamToday: n(today.c), directs: team.directs, walletPaise: wallet, renewalsDue: n(due.c),
      });
    }

    if (b.action === "dashboard") {
      const suiteUserId = S(b.suiteUserId, 36);
      if (!UUID.test(suiteUserId)) return Response.json({ error: "bad user" }, { status: 400 });
      const m = await memberBySuiteUser(d, suiteUserId);
      if (!m) return Response.json({ error: "no partner account" }, { status: 404 });
      const id = n(m.id);
      const [team, wallet, inc, sub, f, sponsor, kyc, lastClosing, recentTeam, recentIncome, due, pendingW] = await Promise.all([
        teamCounts(id), walletBalance(id), incomeTotals(id), subscriptionHistory(id), flags(),
        maybeOne<{ code: string; username: string | null }>(d, "select s.code, s.username from members m join members s on s.id = m.sponsor_id where m.id = $1", [id]),
        maybeOne<{ status: string }>(d, "select status from kyc where member_id = $1", [id]),
        maybeOne<{ d: string | null }>(d, "select max(closing_date)::text as d from closings"),
        d.query<{ code: string; username: string | null; status: string; side: string; joined: string }>(
          `with recursive down as (select id, leg as side from members where parent_id = $1 union all select m.id, down.side from members m join down on m.parent_id = down.id)
           select m.code, m.username, m.status, down.side, m.created_at::text as joined from down join members m on m.id = down.id order by m.id desc limit 6`, [id]),
        d.query<{ kind: string; paise: unknown; day: string }>(
          `select i.kind, i.gross_paise as paise, c.closing_date::text as day from incomes i join closings c on c.id = i.closing_id where i.member_id = $1 order by c.closing_date desc, i.id desc limit 6`, [id]),
        one<{ c: unknown }>(d, "select count(*) as c from members where sponsor_id = $1 and status = 'green' and sub_valid_until is not null and sub_valid_until <= current_date + 7", [id]),
        one<{ p: unknown }>(d, "select coalesce(sum(amount_paise), 0) as p from withdrawals where member_id = $1 and status in ('requested', 'approved')", [id]),
      ]);
      let rank: { current: string | null; next: string | null } = { current: null, next: null };
      if (f["feature.ranks"]) { try { const r = await rankInfo(id); rank = { current: r.current?.name ?? null, next: r.next?.name ?? null }; } catch { /* ranks off */ } }
      const total = Object.values(inc).reduce((a, x) => a + x.total, 0);
      const last = Object.values(inc).reduce((a, x) => a + x.last, 0);
      return Response.json({
        code: m.code, username: m.username, status: m.status, blocked: m.blocked, subValidUntil: m.sub_valid_until,
        sponsor: sponsor ? sponsor.username || sponsor.code : null,
        team: { left: team.left, right: team.right, leftGreen: team.leftGreen, rightGreen: team.rightGreen, directs: team.directs, directsGreen: team.directsGreen },
        walletPaise: wallet, pendingWithdrawPaise: n(pendingW.p),
        income: { totalPaise: total, lastPaise: last, lastClosing: lastClosing?.d ?? null, byKind: inc },
        subscription: { state: sub.state, validTill: sub.validTill, daysLeft: sub.daysLeft },
        kyc: kyc?.status ?? null, rank, renewalsDue: n(due.c),
        recentTeam: recentTeam.map((r) => ({ handle: r.username || r.code, status: r.status, side: r.side, joined: r.joined })),
        recentIncome: recentIncome.map((r) => ({ kind: r.kind, paise: n(r.paise), day: r.day })),
        menu: { team: !!f["member.menu.team"], income: !!f["member.menu.income"], wallet: !!f["member.menu.wallet"], rank: !!f["feature.ranks"] && !!f["member.menu.rank"], subscription: !!f["member.menu.subscription"], kyc: !!f["member.menu.kyc"], downloads: !!f["member.menu.downloads"], support: !!f["member.menu.support"], grow: !!f["member.menu.grow"] },
      });
    }

    // Super Admin → Users: every partner ID, the company's root ID included, so the owner sees one complete list.
    // Joined to app accounts by suiteUserId; IDs with no app account (the root, IDs made in Staff Admin) come too.
    if (b.action === "members") {
      const rows = await d.query<Record<string, unknown>>(
        `select m.code, m.username, m.name, m.mobile, m.email, m.status, m.blocked, m.leg, m.suite_user_id,
                (m.parent_id is null) as is_root, m.created_at::date::text as joined, m.sub_valid_until::text as sub_valid_until,
                coalesce(s.username, s.code) as sponsor, coalesce(p.username, p.code) as parent,
                (select count(*) from members x where x.sponsor_id = m.id) as directs
         from members m left join members s on s.id = m.sponsor_id left join members p on p.id = m.parent_id
         order by m.id desc limit 20000`); // newest first (owner, 27 Sep 2026)
      return Response.json({
        members: rows.map((r) => ({
          code: r.code, username: r.username ?? null, name: r.name, mobile: r.mobile ?? null, email: r.email ?? null,
          status: r.status, blocked: !!r.blocked, leg: r.leg ?? null, suiteUserId: r.suite_user_id ?? null, isRoot: !!r.is_root,
          joined: r.joined, subValidUntil: r.sub_valid_until ?? null, sponsor: r.sponsor ?? null, parent: r.parent ?? null, directs: n(r.directs),
        })),
      });
    }

    // Super Admin → a user's full profile: the partner record of that account (read), and the same edits made there
    // (name, username, mobile, email, date of birth, gender) copied here, so both sides always show the same person.
    if (b.action === "member" || b.action === "member_update") {
      const suiteUserId = S(b.suiteUserId, 36);
      if (!UUID.test(suiteUserId)) return Response.json({ error: "bad user" }, { status: 400 });
      const m = await maybeOne<Record<string, unknown>>(d,
        `select id, code, username, name, mobile, email, status, dob::text as dob, gender, created_at::date::text as joined from members where suite_user_id = $1`, [suiteUserId]);
      if (!m) return Response.json({ error: "no partner account" }, { status: 404 });
      if (b.action === "member") return Response.json({ code: m.code, username: m.username, name: m.name, mobile: m.mobile, email: m.email, status: m.status, dob: m.dob, gender: m.gender, joined: m.joined });

      const sets: string[] = []; const vals: unknown[] = [n(m.id)]; const after: Record<string, unknown> = {};
      const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); after[col] = v; };
      if (b.name !== undefined) { const v = S(b.name, 80); if (v.length < 2) return Response.json({ error: "Name is too short." }, { status: 422 }); put("name", v); }
      if (b.username !== undefined) {
        const v = S(b.username, 20);
        if (!/^[A-Za-z0-9_]{4,20}$/.test(v)) return Response.json({ error: "Username: 4 to 20 letters, numbers or _." }, { status: 422 });
        const taken = await maybeOne(d, "select 1 from members where lower(username) = lower($1) and id <> $2", [v, n(m.id)]);
        if (taken) return Response.json({ error: `The username ${v} is already used by another partner ID.` }, { status: 409 });
        put("username", v);
      }
      if (b.mobile !== undefined) {
        const v = S(b.mobile, 20).replace(/\D/g, "").slice(-10);
        if (v && v.length !== 10) return Response.json({ error: "Mobile must be 10 digits." }, { status: 422 });
        const taken = v ? await maybeOne(d, "select 1 from members where mobile = $1 and id <> $2", [v, n(m.id)]) : null;
        if (taken) return Response.json({ error: "That mobile number is used by another partner ID." }, { status: 409 });
        put("mobile", v || null);
      }
      if (b.email !== undefined) {
        const v = S(b.email, 120).toLowerCase();
        const taken = v ? await maybeOne<{ code: string }>(d, "select code from members where lower(email) = $1 and id <> $2 limit 1", [v, n(m.id)]) : null;
        if (taken) return Response.json({ error: `That email is used by another partner ID (${taken.code}). One email, one ID.` }, { status: 409 });
        put("email", v || null);
      }
      if (b.dob !== undefined) { const v = S(b.dob, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return Response.json({ error: "Date of birth: YYYY-MM-DD." }, { status: 422 }); put("dob", v || null); }
      if (b.gender !== undefined) { const v = S(b.gender, 10); put("gender", ["male", "female", "other"].includes(v) ? v : null); }
      if (!sets.length) return Response.json({ ok: true, nothing: true });
      await d.query(`update members set ${sets.join(", ")} where id = $1`, vals);
      await d.query("insert into audit_log (admin_id, member_id, action, reason, detail) values (null, $1, 'member.edit', $2, $3::text::jsonb)",
        [n(m.id), `by Super Admin (${S(b.by, 120) || "Super Admin"})`, JSON.stringify({ before: { name: m.name, username: m.username, mobile: m.mobile, email: m.email, dob: m.dob, gender: m.gender }, after })]);
      return Response.json({ ok: true, code: m.code });
    }

    // Super Admin → which app account belongs to which partner ID. The SH code is the identity: an ID and an app
    // account are tied only by the account id, set here by hand (or when the ID was made from the app / its account
    // was made for it) — never by a matching email or mobile.
    //   link   { code, suiteUserId } → tie them (both must be free)
    //   unlink { code }              → untie; answers the account id it had
    if (b.action === "link" || b.action === "unlink") {
      const who = S(b.by, 120) || "Super Admin";
      const m = await maybeOne<{ id: unknown; code: string; suite_user_id: string | null }>(d, "select id, code, suite_user_id from members where upper(code) = upper($1)", [S(b.code, 20)]);
      if (!m) return Response.json({ error: "Partner ID not found." }, { status: 404 });
      const log = (action: string, detail: Record<string, unknown>) =>
        d.query("insert into audit_log (admin_id, member_id, action, reason, detail) values (null, $1, $2, $3, $4::text::jsonb)",
          [n(m.id), action, `by Super Admin (${who})`, JSON.stringify(detail)]);
      if (b.action === "unlink") {
        if (!m.suite_user_id) return Response.json({ ok: true, code: m.code, suiteUserId: null, nothing: true });
        await d.query("update members set suite_user_id = null, suite_email = null where id = $1", [n(m.id)]);
        await log("member.unlink", { suiteUserId: m.suite_user_id });
        return Response.json({ ok: true, code: m.code, suiteUserId: m.suite_user_id });
      }
      const suiteUserId = S(b.suiteUserId, 36);
      if (!UUID.test(suiteUserId)) return Response.json({ error: "bad user" }, { status: 400 });
      if (m.suite_user_id === suiteUserId) return Response.json({ ok: true, code: m.code, nothing: true });
      if (m.suite_user_id) return Response.json({ error: `${m.code} is already linked to another app account. Unlink it first.` }, { status: 409 });
      const other = await maybeOne<{ code: string }>(d, "select code from members where suite_user_id = $1", [suiteUserId]);
      if (other) return Response.json({ error: `That app account is already linked to ${other.code}. Unlink it from there first.` }, { status: 409 });
      await d.query("update members set suite_user_id = $2, suite_email = nullif($3, '') where id = $1", [n(m.id), suiteUserId, S(b.email, 120).toLowerCase()]);
      await log("member.link", { suiteUserId, email: S(b.email, 120) || null });
      return Response.json({ ok: true, code: m.code });
    }

    // Super Admin → Staff: every Staff Admin login (sub admin), its duty (role), last login, work done — and the owner
    // manages them from there: create, change role / name, enable / disable, reset password, reset two-step login.
    // Every change is written to the activity log as done by the Super Admin (who = the owner's email).
    if (b.action === "staff") {
      const op = S(b.op, 20);
      const who = S(b.by, 120) || "Super Admin";
      const staffId = Math.round(Number(b.id ?? 0));
      const log = (action: string, detail: Record<string, unknown>) =>
        d.query("insert into audit_log (admin_id, member_id, action, reason, detail) values (null, null, $1, $2, $3::text::jsonb)",
          [action, `by Super Admin (${who})`, JSON.stringify(detail)]);
      const ROLES = ["accounts", "kyc", "support", "viewer", "ca"];
      const newPassword = () => {
        const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        return Array.from(randomBytes(12), (x) => abc[x % abc.length]).join("");
      };
      const target = staffId ? await maybeOne<{ id: unknown; username: string; role: string; active: boolean }>(d, "select id, username, role, active from admins where id = $1", [staffId]) : null;

      if (op === "list") {
        const rows = await d.query<Record<string, unknown>>(
          `select a.id, a.username, a.name, a.role, a.active, a.totp_enabled, a.created_at::text as created,
                  (select max(e.at)::text from login_events e where e.kind = 'admin' and e.subject_id = a.id and e.ok) as last_login,
                  (select e.ip from login_events e where e.kind = 'admin' and e.subject_id = a.id and e.ok order by e.id desc limit 1) as last_ip,
                  (select count(*) from login_events e where e.kind = 'admin' and e.subject_id = a.id and not e.ok and e.at > now() - interval '7 days') as failed7,
                  (select count(*) from audit_log l where l.admin_id = a.id) as actions,
                  (select max(l.at)::text from audit_log l where l.admin_id = a.id) as last_action,
                  (select count(*) from sessions s where s.kind = 'admin' and s.subject_id = a.id and s.expires_at > now()) as online
           from admins a order by a.id desc`); // newest first (owner, 27 Sep 2026)
        return Response.json({ staff: rows.map((r) => ({
          id: n(r.id), username: r.username, name: r.name, role: r.role, active: !!r.active, twoStep: !!r.totp_enabled, created: r.created,
          lastLogin: r.last_login ?? null, lastIp: r.last_ip ?? null, failed7: n(r.failed7), actions: n(r.actions), lastAction: r.last_action ?? null, online: n(r.online) > 0,
        })) });
      }
      if (op === "create") {
        const username = S(b.username, 30).toLowerCase(); const role = S(b.role, 20); const name = S(b.name, 80) || username;
        if (!/^[a-z0-9._-]{3,30}$/.test(username)) return Response.json({ error: "Username: 3 to 30 letters, numbers, dot or dash." }, { status: 422 });
        if (!ROLES.includes(role)) return Response.json({ error: "Choose a duty (role)." }, { status: 422 });
        const typed = S(b.password, 100);
        if (typed && typed.length < 10) return Response.json({ error: "Password must be at least 10 characters (or leave it blank for an automatic one)." }, { status: 422 });
        const password = typed || newPassword();
        const { hashPassword } = await import("@/server/auth/password");
        try {
          const r = await one<{ id: unknown }>(d, "insert into admins (username, name, password_hash, role) values ($1, $2, $3, $4) returning id", [username, name, await hashPassword(password), role]);
          await log("staff.create", { staff: n(r.id), username, role });
          return Response.json({ ok: true, id: n(r.id), username, password });
        } catch { return Response.json({ error: "That username is already taken." }, { status: 409 }); }
      }
      if (!target) return Response.json({ error: "Staff login not found." }, { status: 404 });
      const isOwner = target.role === "owner";
      if (op === "update") {
        const changes: Record<string, unknown> = {};
        if (b.name !== undefined) { const name = S(b.name, 80); if (name.length < 2) return Response.json({ error: "Write a name." }, { status: 422 }); await d.query("update admins set name = $2 where id = $1", [staffId, name]); changes.name = name; }
        if (b.role !== undefined) {
          const role = S(b.role, 20);
          if (isOwner) return Response.json({ error: "The owner's duty cannot be changed." }, { status: 422 });
          if (!ROLES.includes(role)) return Response.json({ error: "Choose a duty (role)." }, { status: 422 });
          await d.query("update admins set role = $2 where id = $1", [staffId, role]); changes.role = role;
          await d.query("delete from sessions where kind = 'admin' and subject_id = $1", [staffId]);   // new duty applies from the next login
        }
        if (b.active !== undefined) {
          if (isOwner) return Response.json({ error: "The owner login cannot be disabled." }, { status: 422 });
          const active = !!b.active;
          await d.query("update admins set active = $2 where id = $1", [staffId, active]); changes.active = active;
          if (!active) await d.query("delete from sessions where kind = 'admin' and subject_id = $1", [staffId]);
        }
        await log("staff.update", { staff: staffId, username: target.username, ...changes });
        return Response.json({ ok: true });
      }
      if (op === "reset") {
        const password = newPassword();
        const { hashPassword } = await import("@/server/auth/password");
        await d.query("update admins set password_hash = $2 where id = $1", [staffId, await hashPassword(password)]);
        await d.query("delete from sessions where kind = 'admin' and subject_id = $1", [staffId]);
        await log("staff.reset_password", { staff: staffId, username: target.username });
        return Response.json({ ok: true, username: target.username, password });
      }
      if (op === "reset2fa") {
        await d.query("update admins set totp_enabled = false, totp_secret = null where id = $1", [staffId]);
        await log("staff.2fa_reset", { staff: staffId, username: target.username });
        return Response.json({ ok: true });
      }
      if (op === "logout") {
        await d.query("delete from sessions where kind = 'admin' and subject_id = $1", [staffId]);
        await log("staff.logout", { staff: staffId, username: target.username });
        return Response.json({ ok: true });
      }
      if (op === "activity") {
        const { actionLabel } = await import("@/lib/format");
        const [acts, logins] = await Promise.all([
          d.query<Record<string, unknown>>(
            `select l.action, l.reason, l.detail, l.at::text as at, m.code, m.username from audit_log l left join members m on m.id = l.member_id
             where l.admin_id = $1 order by l.id desc limit 300`, [staffId]),
          d.query<Record<string, unknown>>(
            `select at::text as at, ok, ip, user_agent, note from login_events where kind = 'admin' and subject_id = $1 order by id desc limit 100`, [staffId]),
        ]);
        return Response.json({
          work: acts.map((r) => ({ at: r.at, action: r.action, label: actionLabel(String(r.action)), member: (r.username as string) || (r.code as string) || null, reason: r.reason ?? null,
            detail: typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail ?? null })),
          logins: logins.map((r) => ({ at: r.at, ok: !!r.ok, ip: r.ip ?? null, device: r.user_agent ?? null, note: r.note ?? null })),
        });
      }
      return Response.json({ error: "unknown staff operation" }, { status: 400 });
    }

    if (b.action === "paid") {
      const suiteUserId = S(b.suiteUserId, 36);
      if (!UUID.test(suiteUserId)) return Response.json({ error: "bad user" }, { status: 400 });
      const ref = S(b.ref, 80);
      const total = Math.round(Number(b.totalPaise ?? 0));
      if (!ref || !(total > 0)) return Response.json({ error: "ref and totalPaise required" }, { status: 400 });
      const m = await memberBySuiteUser(d, suiteUserId);
      if (!m) return Response.json({ error: "no partner account" }, { status: 404 });
      if (m.blocked) return Response.json({ error: "blocked" }, { status: 409 });
      const r = await recordPayment(d, {
        memberId: n(m.id), kind: m.status === "green" ? "renewal" : "activation", method: "online", date: istDate(),
        reference: ref, totalPaise: total, suiteApplied: true, reason: `Shubhora app · ${S(b.tier, 20) || "subscription"}`,
      });
      return Response.json({ ok: true, paymentId: r.paymentId, duplicate: r.duplicate, kind: m.status === "green" ? "renewal" : "activation" });
    }

    // Default (and the original contract): a one-time sign-in address for a signed-in app user.
    if (!UUID.test(String(b.suiteUserId ?? ""))) return Response.json({ error: "bad user" }, { status: 400 });
    const m = await maybeOne<{ id: unknown; blocked: boolean }>(d, "select id, blocked from members where suite_user_id = $1", [b.suiteUserId]);
    if (!m || m.blocked) return Response.json({ error: "no partner ID for this account" }, { status: 404 });
    const token = randomBytes(32).toString("base64url");
    await d.query("delete from link_tokens where expires_at < now() - interval '1 day'");
    // `next`: the panel page to open — "/team", "/wallet"… (the app's Business page deep-links) — or the old "activate".
    const nx = S(b.next, 80);
    const next = nx === "activate" ? "activate" : /^\/[a-z0-9][a-z0-9/_-]{0,80}$/i.test(nx) ? nx : "dashboard";
    await d.query("insert into link_tokens (token_hash, member_id, next, expires_at) values ($1, $2, $3, now() + interval '2 minutes')",
      [createHash("sha256").update(token).digest("hex"), n(m.id), next]);
    return Response.json({ url: `${PUBLIC()}/auth/link?t=${token}` });
  } catch (e) {
    if (e instanceof RuleError) return Response.json({ error: e.message }, { status: 422 });
    console.error("[link-in]", b.action, e);
    return Response.json({ error: "partner service error" }, { status: 500 });
  }
}
