import { Download, FileText } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { Empty, PageHead } from "@/components/ui";
import { withBase } from "@/lib/base";

export const metadata = { title: "Downloads" };

export default async function Downloads() {
  await requireMember();
  const rows = await (await db()).query<Record<string, unknown>>(
    "select d.title, d.description, d.category, d.file_id, f.mime, f.size_bytes from downloads d join files f on f.id = d.file_id where d.active order by d.category, d.sort, d.id desc");
  const cats = [...new Set(rows.map((r) => r.category as string))];
  return (
    <div className="space-y-6">
      <PageHead title="Downloads" sub="Plan, posters and training material from the company." />
      {rows.length === 0 && <Empty>Nothing here yet. The company will add material soon.</Empty>}
      {cats.map((c) => (
        <section key={c}>
          <p className="font-bold mb-3">{c}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.filter((r) => r.category === c).map((r) => {
              const img = String(r.mime).startsWith("image/");
              return (
                <a key={r.file_id as string} href={withBase(`/files/${r.file_id}`)} target="_blank" rel="noreferrer" className="card overflow-hidden hover:shadow-lg transition-shadow">
                  {img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={withBase(`/files/${r.file_id}`)} alt="" className="h-40 w-full object-cover bg-surface2" />
                    : <div className="grid h-40 place-items-center bg-surface2 text-faint"><FileText className="h-10 w-10" /></div>}
                  <div className="p-4">
                    <p className="font-semibold">{r.title as string}</p>
                    {r.description ? <p className="text-sm text-muted">{r.description as string}</p> : null}
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink"><Download className="h-4 w-4" />Open · {Math.round(Number(r.size_bytes) / 1024)} KB</p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
