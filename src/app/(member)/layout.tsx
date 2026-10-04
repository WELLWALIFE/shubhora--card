import { LogOut, Smartphone } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { flags } from "@/server/queries";
import { suiteOrigin } from "@/server/suite";
import { memberLogout } from "@/app/actions/auth";
import { MemberNav } from "@/components/member-nav";
import { IdBadge, Logo } from "@/components/ui";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMember();
  const f = await flags();
  // The partner panel is the "Business" section of the Shubhora app: one account, one login. This is the way back.
  const app = `${suiteOrigin() || "https://shubhora.com"}/poster/business`;
  if (f["feature.maintenance"] && !me.actingAdmin) {
    return <div className="min-h-screen grid place-items-center p-6 text-center"><div><Logo /><p className="mt-6 text-lg font-semibold">We are updating the user panel.</p><p className="mt-1 text-muted">Please check back in a little while.</p></div></div>;
  }
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden lg:flex flex-col gap-8 navy relative overflow-hidden p-5 sticky top-0 h-screen">
        <div className="absolute inset-0 navy-glow opacity-60" />
        <div className="relative"><Logo light sub="User Panel" /></div>
        <a href={app} className="relative inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15"><Smartphone className="h-4 w-4" /> Back to the Shubhora app</a>
        <div className="relative"><MemberNav enabled={f} /></div>
        <div className="relative mt-auto rounded-xl bg-white/6 p-3">
          <p className="text-sm font-semibold truncate">{me.name}</p>
          <p className="text-xs text-white/55">{me.handle}</p>
          <form action={memberLogout} className="mt-2"><button className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/65 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Log out</button></form>
        </div>
      </aside>
      <div className="min-w-0">
        {me.actingAdmin && <div className="bg-amber text-white text-center text-sm font-semibold py-1.5 px-4">Staff Admin view of {me.code}. Everything you do here is recorded.</div>}
        <header className="lg:hidden sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/95 backdrop-blur px-4 h-14">
          <Logo sub="User Panel" />
          <div className="flex items-center gap-3"><IdBadge status={me.status} />
            <a href={app} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-brand-ink"><Smartphone className="h-3.5 w-3.5" /> App</a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        <MemberNavMobileSpacer />
      </div>
      <div className="lg:hidden"><MemberNav enabled={f} /></div>
    </div>
  );
}

function MemberNavMobileSpacer() { return <div className="h-2 lg:hidden" />; }
