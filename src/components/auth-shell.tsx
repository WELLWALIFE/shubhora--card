import { Logo } from "./ui";

/** Split screen used by login and joining: brand panel on the left, form on the right. */
export function AuthShell({ title, sub, children, side }: { title: string; sub?: string; children: React.ReactNode; side?: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden navy p-10">
        <div className="absolute inset-0 navy-glow" />
        <div className="relative"><Logo light /></div>
        <div className="relative max-w-md">
          {side ?? (
            <>
              <h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight">Earn on every sale. <span className="grad-text">And every renewal.</span></h2>
              <p className="mt-4 text-white/65 leading-relaxed">Share Shubhora Business Suite with businesses you know. Track your team, income and wallet in one place.</p>
            </>
          )}
        </div>
        <p className="relative text-xs text-white/40">Shubhora is a product of Wellwa Life India Pvt Ltd.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
