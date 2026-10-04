import { db } from "@/server";
import { n } from "@/server/db";
import { can, getAdmin } from "@/server/auth/session";
import { fyOf, istDate } from "@/server/engine/dates";
import { audit, company } from "@/server/queries";
import { GST_STATES, gstSplit } from "@/lib/gst";

// CSV exports for the admin and the CA. Opens directly in Excel; imports into Tally.

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rupee = (p: unknown) => (n(p) / 100).toFixed(2);

export async function GET(req: Request) {
  const a = await getAdmin();
  if (!a || !can(a, "reports")) return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const type = u.searchParams.get("type") ?? "";
  const today = istDate();
  const from = u.searchParams.get("from") || `${today.slice(0, 7)}-01`;
  const to = u.searchParams.get("to") || today;
  const d = await db();
  let head: string[] = [];
  let rows: unknown[][] = [];

  if (type === "members") {
    head = ["ID", "Name", "Mobile", "Email", "Status", "Green type", "Activated", "Subscription till", "Sponsor", "Placed under", "Side", "PAN", "Joined"];
    const r = await d.query<Record<string, unknown>>(
      `select m.code, m.name, m.mobile, m.email, m.status, m.green_kind, m.green_date::text, m.sub_valid_until::text, s.code as sp, p.code as pa, m.leg, m.pan, m.created_at::date::text as j
       from members m left join members s on s.id = m.sponsor_id left join members p on p.id = m.parent_id order by m.id`);
    rows = r.map((x) => [x.code, x.name, x.mobile, x.email, x.status, x.green_kind, x.green_date, x.sub_valid_until, x.sp, x.pa, x.leg, x.pan, x.j]);
  } else if (type === "gst") {
    const c = await company();
    const cState = c.state_code || (c.gstin ?? "").slice(0, 2);
    const split = (gst: unknown, gstin: unknown, sign = "") => {
      const g = gstSplit(n(gst), cState, gstin as string | null);
      const pos = g.pos ? `${g.pos}-${GST_STATES[g.pos] ?? ""}` : "";
      return [pos, `${sign}${rupee(g.cgst)}`, `${sign}${rupee(g.sgst)}`, `${sign}${rupee(g.igst)}`];
    };
    head = ["Invoice no", "Date", "Member ID", "Name", "Buyer GSTIN", "Type", "Method", "SAC", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "GST total", "Invoice total", "Reference", "Status"];
    const r = await d.query<Record<string, unknown>>(
      `select p.invoice_no, p.business_date::text as day, m.code, m.name, k.gstin, p.kind, p.method, p.base_paise, p.gst_paise, p.total_paise, p.reference, p.status
       from payments p join members m on m.id = p.member_id left join kyc k on k.member_id = m.id
       where p.invoice_no is not null and p.business_date between $1::date and $2::date order by p.id`, [from, to]);
    rows = r.map((x) => [x.invoice_no, x.day, x.code, x.name, x.gstin, x.kind, x.method, c.sac || "998314", ...split(x.gst_paise, x.gstin).slice(0, 1),
      rupee(x.base_paise), ...split(x.gst_paise, x.gstin).slice(1), rupee(x.gst_paise), rupee(x.total_paise), x.reference, x.status]);
    const cn = await d.query<Record<string, unknown>>(
      `select p.credit_note_no, p.invoice_no, (p.refunded_at at time zone 'Asia/Kolkata')::date::text as day, m.code, m.name, k.gstin, p.kind, p.method, p.base_paise, p.gst_paise, p.total_paise
       from payments p join members m on m.id = p.member_id left join kyc k on k.member_id = m.id
       where p.credit_note_no is not null and (p.refunded_at at time zone 'Asia/Kolkata')::date between $1::date and $2::date order by p.id`, [from, to]);
    rows.push(...cn.map((x) => [x.credit_note_no, x.day, x.code, x.name, x.gstin, `credit note on ${x.invoice_no}`, x.method, c.sac || "998314",
      ...split(x.gst_paise, x.gstin).slice(0, 1), `-${rupee(x.base_paise)}`, ...split(x.gst_paise, x.gstin, "-").slice(1),
      `-${rupee(x.gst_paise)}`, `-${rupee(x.total_paise)}`, "", "credit note"]));
  } else if (type === "tds") {
    const fy = u.searchParams.get("fy") || fyOf(today);
    head = ["Member ID", "Name", "PAN", "Financial year", "Gross commission", "TDS deducted", "Net"];
    const r = await d.query<Record<string, unknown>>(
      `select m.code, m.name, m.pan,
              sum(l.amount_paise) filter (where l.entry = 'income') as gross,
              -sum(l.amount_paise) filter (where l.entry = 'tds') as tds
       from ledger l join members m on m.id = l.member_id where l.fy = $1 group by m.id order by m.code`, [fy]);
    rows = r.map((x) => [x.code, x.name, x.pan, fy, rupee(x.gross), rupee(x.tds), rupee(n(x.gross) - n(x.tds))]);
  } else if (type === "tds26q") {
    head = ["Deductee ID", "Deductee name", "PAN", "Section", "Date of credit", "Amount credited", "TDS rate %", "TDS deducted"];
    const r = await d.query<Record<string, unknown>>(
      `select m.code, m.name, m.pan, c.closing_date::text as day,
              sum(l.amount_paise) filter (where l.entry = 'income') as gross,
              -sum(l.amount_paise) filter (where l.entry = 'tds') as tds
       from ledger l join closings c on c.id = l.closing_id join members m on m.id = l.member_id
       where c.closing_date between $1::date and $2::date and l.entry in ('income', 'tds')
       group by m.id, c.closing_date having sum(l.amount_paise) filter (where l.entry = 'tds') < 0
       order by c.closing_date, m.code`, [from, to]);
    rows = r.map((x) => [x.code, x.name, x.pan ?? "PANNOTAVBL", "194H", x.day, rupee(x.gross), n(x.gross) ? ((n(x.tds) / n(x.gross)) * 100).toFixed(2) : "", rupee(x.tds)]);
  } else if (type === "income") {
    head = ["Closing date", "Member ID", "Name", "Income", "Gross", "Held", "From member"];
    const r = await d.query<Record<string, unknown>>(
      `select c.closing_date::text as day, m.code, m.name, i.kind, i.gross_paise, i.held, s.code as src
       from incomes i join closings c on c.id = i.closing_id join members m on m.id = i.member_id left join members s on s.id = i.source_member_id
       where c.closing_date between $1::date and $2::date order by c.closing_date, m.code`, [from, to]);
    rows = r.map((x) => [x.day, x.code, x.name, x.kind, rupee(x.gross_paise), x.held ? "yes" : "", x.src]);
  } else if (type === "ranks") {
    head = ["Achieved on", "Member ID", "Name", "Rank", "Reward", "Instalments", "Paid so far"];
    const r = await d.query<Record<string, unknown>>(
      `select r.achieved_on::text as day, m.code, m.name, r.rank_name, r.reward_paise, r.instalments,
              (select coalesce(sum(amount_paise),0) from reward_instalments i where i.member_id = r.member_id and i.level = r.level and i.status = 'paid') as paid
       from member_ranks r join members m on m.id = r.member_id order by r.achieved_on, m.code`);
    rows = r.map((x) => [x.day, x.code, x.name, x.rank_name, rupee(x.reward_paise), x.instalments, rupee(x.paid)]);
  } else if (type === "wallets") {
    head = ["Member ID", "Name", "Balance"];
    const r = await d.query<Record<string, unknown>>(
      "select m.code, m.name, sum(l.amount_paise) as b from ledger l join members m on m.id = l.member_id group by m.id having sum(l.amount_paise) <> 0 order by m.code");
    rows = r.map((x) => [x.code, x.name, rupee(x.b)]);
  } else if (type === "bankfile") {
    if (!can(a, "money")) return new Response("Not allowed", { status: 403 });
    head = ["Withdrawal no", "Member ID", "Beneficiary name", "Account number", "IFSC", "Bank", "Amount"];
    const r = await d.query<Record<string, unknown>>(
      "select w.id, m.code, w.bank_snapshot, w.amount_paise from withdrawals w join members m on m.id = w.member_id where w.status = 'approved' order by w.id");
    rows = r.map((x) => {
      const b = (typeof x.bank_snapshot === "string" ? JSON.parse(x.bank_snapshot) : x.bank_snapshot) as Record<string, string>;
      return [x.id, x.code, b.account_name, `'${b.account_no}`, b.ifsc, b.bank_name, rupee(x.amount_paise)];
    });
  } else {
    return new Response("Unknown report", { status: 400 });
  }

  await audit(a.id, null, "report.export", null, { type, from, to });
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${type}-${from}-to-${to}.csv"` },
  });
}
