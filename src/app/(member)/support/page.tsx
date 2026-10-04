import Link from "next/link";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { n } from "@/server/db";
import { ticketAction } from "@/app/actions/member";
import { company } from "@/server/queries";
import { ActionForm, Field } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { UploadField } from "@/components/upload";
import { withBase } from "@/lib/base";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "Support" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const me = await requireMember();
  const { t } = await searchParams;
  const d = await db();
  const c = await company();
  const tickets = await d.query<Record<string, unknown>>("select id, subject, status, updated_at::text from tickets where member_id = $1 order by updated_at desc", [me.id]);
  const open = t ? tickets.find((x) => String(x.id) === t) : null;
  const msgs = open ? await d.query<Record<string, unknown>>("select from_admin, body, file_id, at::text from ticket_messages where ticket_id = $1 order by id", [n(open.id)]) : [];

  return (
    <div className="space-y-6">
      <PageHead title="Support" sub="Ask anything about your ID, income or payments." />
      <div className="grid lg:grid-cols-[320px_1fr] gap-6 items-start">
        <div className="space-y-3">
          <Link href="/support" className={`block card p-4 text-sm font-semibold ${!open ? "ring-2 ring-brand" : ""}`}>+ New ticket</Link>
          {tickets.map((x) => (
            <Link key={String(x.id)} href={`/support?t=${x.id}`} className={`block card p-4 ${open && open.id === x.id ? "ring-2 ring-brand" : ""}`}>
              <p className="text-sm font-semibold">{x.subject as string}</p>
              <p className="mt-1 text-xs text-faint">#{String(x.id)} · {dateFmt(x.updated_at as string)} · <span className="capitalize">{x.status as string}</span></p>
            </Link>
          ))}
        </div>
        <div className="card p-6">
          {open ? (
            <>
              <p className="font-bold">{open.subject as string}</p>
              <div className="mt-4 space-y-3">
                {msgs.map((m, i) => (
                  <div key={i} className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${m.from_admin ? "bg-brand-soft" : "bg-surface2 ml-auto"}`}>
                    <p className="text-xs font-semibold text-muted mb-1">{m.from_admin ? "Support team" : "You"} · {dateFmt(m.at as string)}</p>
                    <p className="whitespace-pre-wrap">{m.body as string}</p>
                    {m.file_id ? <a href={withBase(`/files/${m.file_id}`)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand-ink">View attachment</a> : null}
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <ActionForm action={ticketAction} submit="Send reply">
                  <input type="hidden" name="ticket" value={String(open.id)} />
                  <textarea name="body" rows={3} className="input" placeholder="Write a reply" required />
                  <UploadField name="file" kind="ticket" label="Add a screenshot (optional)" accept="image/*,application/pdf" />
                </ActionForm>
              </div>
            </>
          ) : (
            <ActionForm action={ticketAction} submit="Send">
              <Field label="Subject" name="subject" required />
              <div><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={5} className="input" required /></div>
              <UploadField name="file" kind="ticket" label="Add a screenshot (optional)" accept="image/*,application/pdf" />
            </ActionForm>
          )}
        </div>
      </div>
      <div className="card p-5 text-sm text-muted">
        <p className="font-bold text-ink">Grievance officer</p>
        <p className="mt-1">{[c.grievance_name, c.grievance_email, c.grievance_phone].filter(Boolean).join(" · ") || "Details will be added by the company."}</p>
        {(c.support_phone || c.support_email) && <p className="mt-2"><b className="text-ink">Support:</b> {[c.support_phone, c.support_email].filter(Boolean).join(" · ")}</p>}
        <p className="mt-1 text-xs text-faint">As required by the Consumer Protection (Direct Selling) Rules, 2021.</p>
      </div>
    </div>
  );
}
