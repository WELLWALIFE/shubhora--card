import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { downloadAction, downloadToggleAction } from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { UploadField } from "@/components/upload";
import { PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "Downloads" };

export default async function Downloads() {
  await requireAdmin("support");
  const rows = await (await db()).query<Record<string, unknown>>(
    "select d.*, d.created_at::text as at, f.name as file_name, f.size_bytes, f.mime from downloads d join files f on f.id = d.file_id order by d.category, d.id desc");
  return (
    <div className="space-y-5">
      <PageHead title="Downloads" sub="Plan PDF, posters, brochures and training material for members. Photos are reduced in size automatically." />
      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="card overflow-x-auto">
          <table className="grid-table">
            <thead><tr><th>Title</th><th>Category</th><th>File</th><th>Added</th><th>Shown</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted">Nothing uploaded yet.</td></tr>}
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <td className="font-medium">{r.title as string}<span className="block text-xs text-muted">{(r.description as string) ?? ""}</span></td>
                  <td>{r.category as string}</td>
                  <td><a href={withBase(`/files/${r.file_id}`)} target="_blank" rel="noreferrer" className="text-brand-ink text-xs">{r.file_name as string}</a><span className="block text-[11px] text-faint">{Math.round(Number(r.size_bytes) / 1024)} KB</span></td>
                  <td>{dateFmt(r.at as string)}</td>
                  <td>{r.active ? "Yes" : "Hidden"}</td>
                  <td><form action={downloadToggleAction}><input type="hidden" name="download" value={String(r.id)} /><button className="btn btn-ghost px-2.5 py-1.5 text-xs">{r.active ? "Hide" : "Show"}</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card p-5">
          <p className="font-bold mb-4">Add a file</p>
          <ActionForm action={downloadAction} submit="Add">
            <Field label="Title" name="title" required />
            <Field label="Category" name="category" placeholder="Plan, Posters, Training…" />
            <Field label="Short description (optional)" name="description" />
            <UploadField name="file" kind="download" label="File (photo or PDF, up to 15 MB)" accept="image/*,application/pdf" maxDim={2400} />
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
