import "server-only";
import { db } from "./index";
import { maybeOne, n, one } from "./db";
import { istDate } from "./engine/dates";
import { settingsFor } from "./engine/settings";

export async function flags(): Promise<Record<string, boolean>> {
  const rows = await (await db()).query<{ key: string; enabled: boolean }>("select key, enabled from flags");
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
}

export async function audit(adminId: number | null, memberId: number | null, action: string, reason: string | null, detail?: unknown) {
  await (await db()).query("insert into audit_log (admin_id, member_id, action, reason, detail) values ($1,$2,$3,$4,$5::text::jsonb)",
    [adminId, memberId, action, reason, detail === undefined ? null : JSON.stringify(detail)]);
}

export async function walletBalance(memberId: number): Promise<number> {
  const r = await one<{ b: unknown }>(await db(), "select coalesce(sum(amount_paise), 0) as b from ledger where member_id = $1", [memberId]);
  const pending = await one<{ p: unknown }>(await db(),
    "select coalesce(sum(amount_paise), 0) as p from withdrawals where member_id = $1 and status in ('requested', 'approved')", [memberId]);
  return n(r.b) - n(pending.p);
}

export type BinaryView = { carryL: number; carryR: number; totalL: number; totalR: number; firstPair: boolean; pairs: number;
  todayL: number; todayR: number };

/** Leg volumes including BV that is not closed yet (so members see today's joinings immediately). */
export async function binaryView(memberId: number): Promise<Record<"new" | "renewal", BinaryView>> {
  const d = await db();
  const st = await d.query<Record<string, unknown>>("select * from binary_state where member_id = $1", [memberId]);
  const open = await d.query<Record<string, unknown>>(
    `with recursive down as (
       select id, leg as side from members where parent_id = $1
       union all
       select m.id, down.side from members m join down on m.parent_id = down.id
     )
     select e.bin, down.side, sum(e.bv) as bv from bv_events e join down on down.id = e.member_id
     where e.closing_id is null and not e.void group by e.bin, down.side`, [memberId]);
  const out = {} as Record<"new" | "renewal", BinaryView>;
  for (const bin of ["new", "renewal"] as const) {
    const s = st.find((r) => r.bin === bin);
    const o = (side: string) => n(open.find((r) => r.bin === bin && r.side === side)?.bv);
    out[bin] = {
      carryL: n(s?.carry_left), carryR: n(s?.carry_right), totalL: n(s?.total_left) + o("L"), totalR: n(s?.total_right) + o("R"),
      firstPair: !!s?.first_pair_done, pairs: n(s?.pairs_total), todayL: o("L"), todayR: o("R"),
    };
  }
  return out;
}

export async function incomeTotals(memberId: number) {
  const rows = await (await db()).query<{ kind: string; total: unknown; today: unknown }>(
    `select i.kind, sum(i.gross_paise) as total,
            sum(i.gross_paise) filter (where c.closing_date = (select max(closing_date) from closings)) as today
     from incomes i join closings c on c.id = i.closing_id where i.member_id = $1 group by i.kind`, [memberId]);
  const get = (k: string) => rows.find((r) => r.kind === k);
  const kinds = ["direct", "match_new", "match_renewal", "sponsor", "rank_reward"] as const;
  return Object.fromEntries(kinds.map((k) => [k, { total: n(get(k)?.total), last: n(get(k)?.today) }])) as
    Record<(typeof kinds)[number], { total: number; last: number }>;
}

export async function teamCounts(memberId: number) {
  const r = await one<Record<string, unknown>>(await db(),
    `with recursive down as (
       select id, leg as side from members where parent_id = $1
       union all
       select m.id, down.side from members m join down on m.parent_id = down.id
     )
     select count(*) filter (where d.side = 'L') as l, count(*) filter (where d.side = 'R') as r,
            count(*) filter (where d.side = 'L' and m.status = 'green') as lg,
            count(*) filter (where d.side = 'R' and m.status = 'green') as rg,
            (select count(*) from members where sponsor_id = $1) as directs,
            (select count(*) from members where sponsor_id = $1 and status = 'green') as directs_green
     from down d join members m on m.id = d.id`, [memberId]);
  return { left: n(r.l), right: n(r.r), leftGreen: n(r.lg), rightGreen: n(r.rg), directs: n(r.directs), directsGreen: n(r.directs_green) };
}

export type TreeNode = { id: number; code: string; handle: string; name: string; status: string; parent: number | null; leg: string | null; depth: number; joined: string;
  subActive: boolean; sponsor: string; /** whole team under each leg: green and red IDs */ team: { greenL: number; redL: number; greenR: number; redR: number };
  bv?: { L: number; R: number; carryL: number; carryR: number; pairs: number } };
export type Bin = "new" | "renewal";

/** A window of the tree: `root` and `levels` levels below it. With `bin`, each node carries its lifetime and
 *  carry-forward BV and pairs in that binary (closed volume plus today's not-yet-closed volume). */
export async function treeWindow(rootId: number, levels = 3, bin?: Bin): Promise<TreeNode[]> {
  const d = await db();
  const rows = await d.query<Record<string, unknown>>(
    `with recursive t as (
       select id, 0 as lvl from members where id = $1
       union all
       select m.id, t.lvl + 1 from members m join t on m.parent_id = t.id where t.lvl < $2
     )
     select m.id, m.code, m.username, m.name, m.status, m.parent_id, m.leg, t.lvl, m.created_at::date::text as joined,
            (m.sub_valid_until >= $4::date) as sub_active,
            coalesce(sp.username, sp.code) as sponsor,
            b.total_left, b.total_right, b.carry_left, b.carry_right, b.pairs_total
     from t join members m on m.id = t.id left join members sp on sp.id = m.sponsor_id left join binary_state b on b.member_id = m.id and b.bin = $3`,
    [rootId, levels, bin ?? "new", istDate()]);
  // Green / red IDs in the whole team under each leg of every node in the window (hover card on the tree).
  const teamRows = rows.length ? await d.query<Record<string, unknown>>(
    `with recursive down as (
       select m.parent_id as anc, m.leg as side, m.id, m.status from members m where m.parent_id = any($1::bigint[])
       union all
       select down.anc, down.side, m.id, m.status from down join members m on m.parent_id = down.id
     ) select anc, side, status, count(*) as c from down group by anc, side, status`, [rows.map((r) => n(r.id))]) : [];
  const team = new Map<number, { greenL: number; redL: number; greenR: number; redR: number }>();
  for (const r of teamRows) {
    const t = team.get(n(r.anc)) ?? { greenL: 0, redL: 0, greenR: 0, redR: 0 };
    const key = `${r.status === "green" ? "green" : "red"}${r.side === "L" ? "L" : "R"}` as keyof typeof t;
    t[key] += n(r.c);
    team.set(n(r.anc), t);
  }
  const nodes: TreeNode[] = rows.map((r) => ({ id: n(r.id), code: r.code as string, handle: (r.username as string | null) || (r.code as string), name: r.name as string, status: r.status as string,
    parent: r.parent_id === null ? null : n(r.parent_id), leg: (r.leg as string) ?? null, depth: n(r.lvl), joined: r.joined as string,
    subActive: !!r.sub_active,
    sponsor: (r.sponsor as string | null) ?? "",
    team: team.get(n(r.id)) ?? { greenL: 0, redL: 0, greenR: 0, redR: 0 },
    bv: bin ? { L: n(r.total_left), R: n(r.total_right), carryL: n(r.carry_left), carryR: n(r.carry_right), pairs: n(r.pairs_total) } : undefined }));
  if (bin && nodes.length) {
    // Add BV that joined today and is not closed yet, so the tree matches the dashboard.
    const open = await d.query<Record<string, unknown>>(
      `with recursive up as (
         select e.bv, m.parent_id as anc, m.leg as side from bv_events e join members m on m.id = e.member_id
         where e.closing_id is null and not e.void and e.bin = $1 and m.parent_id is not null
         union all select up.bv, m.parent_id, m.leg from up join members m on m.id = up.anc where m.parent_id is not null
       ) select anc, side, sum(bv) as bv from up where anc = any($2::bigint[]) group by anc, side`, [bin, nodes.map((x) => x.id)]);
    for (const o of open) {
      const node = nodes.find((x) => x.id === n(o.anc));
      if (!node?.bv) continue;
      if (o.side === "L") { node.bv.L += n(o.bv); node.bv.carryL += n(o.bv); } else { node.bv.R += n(o.bv); node.bv.carryR += n(o.bv); }
    }
  }
  return nodes;
}

export async function isInTeam(ancestorId: number, nodeId: number): Promise<boolean> {
  const r = await one<{ ok: boolean }>(await db(),
    `with recursive up as (
       select id, parent_id from members where id = $2
       union all
       select m.id, m.parent_id from members m join up on m.id = up.parent_id
     ) select exists (select 1 from up where id = $1) as ok`, [ancestorId, nodeId]);
  return !!r.ok;
}

export async function memberProfile(memberId: number) {
  return maybeOne<Record<string, unknown>>(await db(),
    `select m.id, m.code, m.name, m.mobile, m.email, m.pan, m.status, m.green_kind, m.green_date::text, m.blocked,
            m.income_hold, m.withdraw_block, m.show_balance, m.leg, m.depth, m.sub_valid_until::text,
            m.created_at, m.suite_user_id, m.suite_email, m.dob::text, m.gender, s.code as sponsor_code, s.name as sponsor_name, p.code as parent_code
     from members m left join members s on s.id = m.sponsor_id left join members p on p.id = m.parent_id
     where m.id = $1`, [memberId]);
}

export async function planNow() {
  return (await settingsFor(await db(), istDate())).s;
}

export async function announcementsNow() {
  return (await db()).query<{ id: unknown; title: string; body: string; publish_at: string }>(
    "select id, title, body, publish_at::text from announcements where active and publish_at <= now() order by publish_at desc limit 5");
}

export async function rankInfo(memberId: number) {
  const d = await db();
  const { loadRanks, RANK_PAIRS_SQL } = await import("./engine/ranks");
  const ranks = await loadRanks(d);
  const pairs = n((await d.query<{ pairs: unknown }>(`select pairs from (${RANK_PAIRS_SQL}) p where member_id = $1`, [memberId]))[0]?.pairs);
  const directs = n((await one<{ c: unknown }>(d, "select count(*) as c from members where sponsor_id = $1 and status = 'green'", [memberId])).c);
  const earned = await d.query<{ level: unknown; rank_name: string; achieved_on: string; reward_paise: unknown }>(
    "select level, rank_name, achieved_on::text, reward_paise from member_ranks where member_id = $1 order by level", [memberId]);
  const instalments = await d.query<Record<string, unknown>>(
    "select level, seq, due_on::text, amount_paise, status, note from reward_instalments where member_id = $1 order by level, seq", [memberId]);
  const top = earned.length ? earned[earned.length - 1] : null;
  const have = new Set(earned.map((e) => n(e.level)));
  const next = ranks.find((r) => !have.has(r.level)) ?? null;
  return { ranks, pairs, directs, earned, instalments, current: top ? { level: n(top.level), name: top.rank_name } : null, next };
}

// ---------- company details ----------

export async function company(): Promise<Record<string, string>> {
  const rows = await (await db()).query<{ key: string; value: string }>("select key, value from company_settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------- subscription history ----------

export type SubRow = { id: number; kind: string; method: string; status: string; paidOn: string; from: string; to: string;
  invoice: string | null; total: number; delayDays: number | null; reference: string | null };

/** Every payment with its period, and how many days early (negative) or late (positive) each renewal was. */
export async function subscriptionHistory(memberId: number) {
  const rows = await (await db()).query<Record<string, unknown>>(
    `select id, kind, method, status, business_date::text as paid_on, period_from::text as pf, period_to::text as pt,
            invoice_no, total_paise, reference
     from payments where member_id = $1 order by business_date, id`, [memberId]);
  const out: SubRow[] = [];
  let prevEnd: string | null = null;
  for (const r of rows) {
    let delay: number | null = null;
    if (r.kind === "renewal" && prevEnd && r.status === "paid") {
      const due = new Date(`${prevEnd}T00:00:00Z`).getTime() + 86400000;
      delay = Math.round((new Date(`${r.paid_on}T00:00:00Z`).getTime() - due) / 86400000);
    }
    if (r.status === "paid") prevEnd = r.pt as string;
    out.push({ id: n(r.id), kind: r.kind as string, method: r.method as string, status: r.status as string, paidOn: r.paid_on as string,
      from: r.pf as string, to: r.pt as string, invoice: (r.invoice_no as string) ?? null, total: n(r.total_paise), delayDays: delay,
      reference: (r.reference as string) ?? null });
  }
  const paid = out.filter((x) => x.status === "paid");
  const activation = paid.find((x) => x.kind === "activation") ?? null;
  const renewals = paid.filter((x) => x.kind === "renewal");
  const last = renewals.length ? renewals[renewals.length - 1] : null;
  const validTill = paid.length ? paid.reduce((a, x) => (x.to > a ? x.to : a), paid[0].to) : null;
  const today = istDate();
  const daysLeft = validTill ? Math.round((new Date(`${validTill}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null;
  const late = renewals.filter((x) => (x.delayDays ?? 0) > 0);
  return {
    rows: out.reverse(), activation, lastRenewal: last, renewalsCount: renewals.length, validTill, daysLeft,
    state: validTill === null ? "none" : daysLeft! >= 0 ? (daysLeft! <= 7 ? "due soon" : "active") : "lapsed",
    lateCount: late.length, avgDelay: late.length ? Math.round(late.reduce((a, x) => a + (x.delayDays ?? 0), 0) / late.length) : 0,
  };
}

// ---------- one timeline of everything that happened to an ID ----------

export type TimelineItem = { at: string; kind: string; text: string; by: string | null };

export async function memberTimeline(memberId: number, limit = 200): Promise<TimelineItem[]> {
  const rows = await (await db()).query<Record<string, unknown>>(
    `select * from (
       select created_at as at, 'joined' as kind, 'Registered (Red ID)' as text, null::text as by from members where id = $1
       union all select paid_at, 'payment', initcap(kind) || ' · ' || method || ' · ₹' || (total_paise / 100)::text || coalesce(' · ' || invoice_no, ''), (select username from admins where id = created_by) from payments where member_id = $1
       union all select refunded_at, 'refund', 'Payment refunded: ' || coalesce(refund_reason, ''), null from payments where member_id = $1 and refunded_at is not null
       union all select (achieved_on::timestamp at time zone 'Asia/Kolkata'), 'rank', 'Rank achieved: ' || rank_name, null from member_ranks where member_id = $1
       union all select submitted_at, 'kyc', 'KYC submitted', null from kyc where member_id = $1
       union all select reviewed_at, 'kyc', 'KYC ' || status || coalesce(': ' || reject_reason, ''), (select username from admins where id = reviewed_by) from kyc where member_id = $1 and reviewed_at is not null
       union all select requested_at, 'withdrawal', 'Withdrawal requested ₹' || (amount_paise / 100)::text, null from withdrawals where member_id = $1
       union all select decided_at, 'withdrawal', 'Withdrawal ' || status || coalesce(' · UTR ' || utr, '') || coalesce(' · ' || reject_reason, ''), (select username from admins where id = decided_by) from withdrawals where member_id = $1 and decided_at is not null
       union all select at, 'admin', action || coalesce(': ' || reason, ''), (select username from admins where id = admin_id) from audit_log where member_id = $1
       union all select at, 'login', case when ok then 'Logged in' else 'Failed login' end || coalesce(' · ' || ip, ''), null from login_events where kind = 'member' and subject_id = $1
       union all select created_at, 'payment', 'Manual payment sent: ' || method || ' · UTR ' || reference || ' · ₹' || (amount_paise / 100)::text || ' (' || status || ')', null from payment_requests where member_id = $1
       union all select at, 'note', 'Note: ' || body, (select username from admins where id = admin_id) from member_notes where member_id = $1
     ) t where at is not null order by at desc limit $2`, [memberId, limit]);
  const { actionLabel } = await import("@/lib/format");
  return rows.map((r) => {
    let text = r.text as string;
    if (r.kind === "admin") { const [act, ...rest] = text.split(": "); text = actionLabel(act) + (rest.length ? `: ${rest.join(": ")}` : ""); }
    return { at: String(r.at), kind: r.kind as string, text, by: (r.by as string) ?? null };
  });
}

/** Path from the top of the tree down to this member (placement upline). */
export async function uplinePath(memberId: number) {
  return (await db()).query<{ code: string; name: string; leg: string | null }>(
    `with recursive up as (
       select id, parent_id, code, name, leg, 0 as step from members where id = $1
       union all select m.id, m.parent_id, m.code, m.name, m.leg, up.step + 1 from members m join up on m.id = up.parent_id
     ) select code, name, leg from up order by step desc`, [memberId]);
}

export async function recordLogin(kind: "member" | "admin", subjectId: number | null, loginText: string, ok: boolean, note?: string) {
  const { headers } = await import("next/headers");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const d = await db();
  await d.query("insert into login_events (kind, subject_id, login_text, ok, note, ip, user_agent) values ($1,$2,$3,$4,$5,$6,$7)",
    [kind, subjectId, loginText.slice(0, 80), ok, note ?? null, ip, h.get("user-agent")?.slice(0, 300) ?? null]);
  if (ok && kind === "member" && subjectId) await d.query("update members set last_login_at = now(), last_login_ip = $2 where id = $1", [subjectId, ip]);
}
