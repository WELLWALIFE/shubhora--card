import { db } from "@/server";
import { requireAdmin } from "@/server/auth/session";
import { flagAction } from "@/app/actions/admin";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Show / hide" };

export default async function Controls() {
  await requireAdmin("plan");
  const rows = await (await db()).query<{ key: string; enabled: boolean; label: string; grp: string }>("select key, enabled, label, grp from flags order by grp, label");
  const groups = [...new Set(rows.map((r) => r.grp))];
  return (
    <div className="space-y-6">
      <PageHead title="Show / hide" sub="Switch menus and features on or off for all members. For one member, use the controls on their page." />
      <div className="grid lg:grid-cols-2 gap-4">
        {groups.map((g) => (
          <div key={g} className="card p-5">
            <p className="font-bold mb-3">{g}</p>
            <ul className="divide-y divide-line">
              {rows.filter((r) => r.grp === g).map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm font-medium">{r.label}</span>
                  <form action={flagAction}>
                    <input type="hidden" name="key" value={r.key} /><input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                    <button role="switch" aria-checked={r.enabled} aria-label={r.label}
                      className={`relative h-6 w-11 rounded-full transition-colors ${r.enabled ? "bg-green" : "bg-line"}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${r.enabled ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
