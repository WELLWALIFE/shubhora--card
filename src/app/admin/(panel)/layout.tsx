import { AppWindow, ExternalLink, LogOut } from "lucide-react";
import { can, PERMS, requireAdmin, type Perm } from "@/server/auth/session";
import { adminLogout } from "@/app/actions/auth";
import { AdminNav } from "@/components/admin-nav";
import { Logo } from "@/components/ui";
import { withBase } from "@/lib/base";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await requireAdmin();
  const allowed = (Object.keys(PERMS) as Perm[]).filter((p) => can(a, p));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="navy relative overflow-hidden lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto p-4 lg:p-5 flex flex-col gap-4 lg:gap-6">
        <div className="absolute inset-0 navy-glow opacity-50" />
        <div className="relative flex items-center justify-between"><Logo light sub="Staff Admin" />
          <form action={adminLogout} className="lg:hidden"><button aria-label="Log out" className="text-white/60"><LogOut className="h-5 w-5" /></button></form>
        </div>
        <div className="relative"><AdminNav allowed={allowed} /></div>
        {a.role === "owner" && (
          <a href={withBase("/admin/shubhora")} target="_blank" rel="noreferrer"
            className="relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-white bg-white/8 hover:bg-white/12">
            <AppWindow className="h-4 w-4" />Shubhora app admin <ExternalLink className="ml-auto h-3.5 w-3.5 text-white/50" />
          </a>
        )}
        <div className="relative mt-auto hidden lg:block rounded-xl bg-white/6 p-3">
          <p className="text-sm font-semibold">{a.name}</p>
          <p className="text-xs text-white/55 capitalize">{a.role}</p>
          <form action={adminLogout} className="mt-2"><button className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/65 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Log out</button></form>
        </div>
      </aside>
      <main className="min-w-0">
        <div className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur px-4 sm:px-6 lg:px-8 py-3">
          <form action={withBase("/admin/members")} className="mx-auto max-w-7xl flex gap-2">
            <input name="q" placeholder="Find a member: ID, name, mobile, email or PAN" className="input max-w-md" aria-label="Find a member" />
            <button className="btn btn-ghost">Find</button>
          </form>
        </div>
        <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><div className="mx-auto max-w-7xl">{children}</div></div>
      </main>
    </div>
  );
}
