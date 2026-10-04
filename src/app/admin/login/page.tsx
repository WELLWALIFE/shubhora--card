import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Field } from "@/components/forms";
import { adminLogin } from "@/app/actions/auth";
import { getAdmin } from "@/server/auth/session";
import { suiteOrigin, suiteReady } from "@/server/suite";

export const metadata = { title: "Staff Admin log in" };

// Two ways in: the owner's Shubhora app login (the app's Super Admin hands them over, see /auth/admin-link), or
// the panel's own staff username + password (+ 2-step code) for everybody else.
export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  if (await getAdmin()) redirect("/admin");
  const { link } = await searchParams;
  const suite = suiteReady() ? suiteOrigin() : "";
  return (
    <AuthShell title="Staff Admin log in" sub="For company staff only. Every action is recorded."
      side={<h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight">Staff <span className="grad-text">Admin</span></h2>}>
      {link === "expired" && <p className="mb-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">That sign-in pass has expired. Press the button below to come in again.</p>}
      {link === "noowner" && <p className="mb-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">No active owner login exists in this panel yet. Log in with the staff form below.</p>}
      {suite && (
        <>
          <a href={`${suite}/admin?to=partners`} className="btn btn-primary w-full justify-center">Log in with my Super Admin account</a>
          <p className="mt-2 text-xs text-muted">For the owner: the Super Admin login opens Staff Admin too — no second password.</p>
          <div className="my-6 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />staff login<span className="h-px flex-1 bg-line" /></div>
        </>
      )}
      <ActionForm action={adminLogin} submit="Log in">
        <Field label="Username" name="username" required autoComplete="username" />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" />
        <Field label="6-digit code (if two-step login is on)" name="code" inputMode="numeric" autoComplete="one-time-code" />
      </ActionForm>
    </AuthShell>
  );
}
