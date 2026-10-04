import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { newsAction, newsToggleAction } from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "News" };

export default async function News() {
  await requireAdmin("support");
  const rows = await (await db()).query<Record<string, unknown>>("select id, title, body, active, publish_at::text from announcements order by id desc");
  return (
    <div className="space-y-6">
      <PageHead title="News and announcements" sub="Shown on every member's home screen." />
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-3">
          {rows.length === 0 && <p className="text-sm text-muted">No announcements yet.</p>}
          {rows.map((r) => (
            <div key={String(r.id)} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-bold">{r.title as string}</p><p className="text-xs text-faint">{dateFmt(r.publish_at as string)} · {r.active ? "Showing" : "Hidden"}</p></div>
                <form action={newsToggleAction}><input type="hidden" name="news" value={String(r.id)} /><button className="btn btn-ghost text-xs">{r.active ? "Hide" : "Show"}</button></form>
              </div>
              <p className="mt-2 text-sm text-muted whitespace-pre-wrap">{r.body as string}</p>
            </div>
          ))}
        </div>
        <div className="card p-5">
          <p className="font-bold mb-4">New announcement</p>
          <ActionForm action={newsAction} submit="Publish">
            <Field label="Title" name="title" required />
            <div><label className="label" htmlFor="body">Message</label><textarea id="body" name="body" rows={5} className="input" required /></div>
            <Field label="Publish at (optional)" name="publish_at" type="datetime-local" />
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
