import Link from "next/link";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { ticketReplyAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";
import { dateFmt, dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Support" };

export default async function SupportAdmin({ searchParams }: { searchParams: Promise<{ t?: string; s?: string }> }) {
  await requireAdmin("support");
  const { t, s = "open" } = await searchParams;
  const d = await db();
  const list = await d.query<Record<string, unknown>>(
    `select t.id, t.subject, t.status, t.updated_at::text, m.code, m.name from tickets t join members m on m.id = t.member_id
     where ($1 = 'all' or t.status = $1) order by t.updated_at desc limit 200`, [s]);
  const open = t ? (await d.query<Record<string, unknown>>(
    "select t.*, m.code, m.name from tickets t join members m on m.id = t.member_id where t.id = $1", [Number(t)]))[0] : null;
  const msgs = open ? await d.query<Record<string, unknown>>(
    "select tm.body, tm.file_id, tm.at::text, a.name as admin from ticket_messages tm left join admins a on a.id = tm.from_admin where ticket_id = $1 order by tm.id", [n(open.id)]) : [];
  return (
    <div className="space-y-5">
      <PageHead title="Support tickets" />
      <div className="flex gap-1">{["open", "answered", "closed", "all"].map((k) =>
        <Link key={k} href={`/admin/support?s=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${s === k ? "bg-brand text-white" : "bg-surface border border-line text-muted"}`}>{k}</Link>)}</div>
      <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
        <div className="space-y-2">
          {list.length === 0 && <p className="text-sm text-muted">No tickets.</p>}
          {list.map((x) => (
            <Link key={String(x.id)} href={`/admin/support?s=${s}&t=${x.id}`} className={`block card p-4 ${open && open.id === x.id ? "ring-2 ring-brand" : ""}`}>
              <p className="text-sm font-semibold">{x.subject as string}</p>
              <p className="mt-1 text-xs text-faint">{x.code as string} · {x.name as string} · {dateFmt(x.updated_at as string)}</p>
            </Link>
          ))}
        </div>
        {open && (
          <div className="card p-5">
            <p className="font-bold">{open.subject as string}</p>
            <p className="text-sm text-muted"><Link href={`/admin/members/${open.code}`} className="text-brand-ink font-mono">{open.code as string}</Link> · {open.name as string}</p>
            <div className="mt-4 space-y-3">
              {msgs.map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${m.admin ? "bg-brand-soft ml-auto" : "bg-surface2"}`}>
                  <p className="text-xs font-semibold text-muted mb-1">{(m.admin as string) ?? "Member"} · {dateTimeFmt(m.at as string)}</p>
                  <p className="whitespace-pre-wrap">{m.body as string}</p>
                  {m.file_id ? <a href={withBase(`/files/${m.file_id}`)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand-ink">View attachment</a> : null}
                </div>
              ))}
            </div>
            <div className="mt-5">
              <ActionForm action={ticketReplyAction} submit="Send reply">
                <input type="hidden" name="ticket" value={String(open.id)} />
                <textarea name="body" rows={3} className="input" placeholder="Reply to the member" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="close" value="1" /> Close the ticket</label>
              </ActionForm>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
