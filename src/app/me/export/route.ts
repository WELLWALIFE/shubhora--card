import { db } from "@/server";
import { n } from "@/server/db";
import { getMember } from "@/server/auth/session";

// A member's own statements as CSV (opens in Excel).
const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rupee = (p: unknown) => (n(p) / 100).toFixed(2);

export async function GET(req: Request) {
  const me = await getMember();
  if (!me) return new Response("Please log in", { status: 401 });
  const type = new URL(req.url).searchParams.get("type");
  const d = await db();
  let head: string[]; let rows: unknown[][];
  if (type === "wallet") {
    const show = (await d.query<{ show_balance: boolean }>("select show_balance from members where id = $1", [me.id]))[0]?.show_balance;
    if (!show) return new Response("Not available", { status: 403 });
    head = ["Date", "Entry", "Note", "Amount"];
    rows = (await d.query<Record<string, unknown>>("select created_at::date::text as d, entry, note, amount_paise from ledger where member_id = $1 order by id", [me.id]))
      .map((r) => [r.d, r.entry, r.note, rupee(r.amount_paise)]);
  } else if (type === "income") {
    head = ["Closing date", "Income", "From member", "Gross amount", "Held"];
    rows = (await d.query<Record<string, unknown>>(
      `select c.closing_date::text as d, i.kind, s.code, i.gross_paise, i.held from incomes i join closings c on c.id = i.closing_id
       left join members s on s.id = i.source_member_id where i.member_id = $1 order by c.closing_date, i.id`, [me.id]))
      .map((r) => [r.d, r.kind, r.code, rupee(r.gross_paise), r.held ? "yes" : ""]);
  } else if (type === "team") {
    head = ["ID", "Name", "Side", "Status", "Joined", "Activated", "Subscription till"];
    rows = (await d.query<Record<string, unknown>>(
      `with recursive down as (select id, leg as side from members where parent_id = $1 union all select m.id, down.side from members m join down on m.parent_id = down.id)
       select m.code, m.name, d.side, m.status, m.created_at::date::text as j, m.green_date::text as g, m.sub_valid_until::text as v
       from down d join members m on m.id = d.id order by m.id`, [me.id]))
      .map((r) => [r.code, r.name, r.side === "L" ? "Left" : "Right", r.status, r.j, r.g, r.v]);
  } else return new Response("Unknown", { status: 400 });
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${me.code}-${type}.csv"` } });
}
