import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Field } from "@/components/forms";
import { memberLogin } from "@/app/actions/auth";
import { getMember } from "@/server/auth/session";
import { suiteOrigin } from "@/server/suite";

export const metadata = { title: "Log in" };

// One login for everything. Whoever lands here without a session is handed to the Shubhora app, which signs them
// in (or already has) and brings them straight back through /api/partner-panel — this page is normally never seen.
// The password form below is kept only for partner IDs from before the app accounts (?legacy=1), and as the way
// in when a one-time pass has expired (so an expired pass can never bounce a person back and forth).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ link?: string; legacy?: string }> }) {
  if (await getMember()) redirect("/dashboard");
  const { link, legacy } = await searchParams;
  const suite = suiteOrigin() || "https://shubhora.com";
  if (!legacy && link !== "expired") redirect(`${suite}/api/partner-panel`);
  return (
    <AuthShell title="Log in" sub="Your Shubhora account opens the app and this user panel — one login.">
      {link === "expired" && <p className="mb-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">That sign-in pass has expired. Press the button below to come in again.</p>}
      <a href={`${suite}/api/partner-panel`} className="btn btn-primary w-full justify-center">Continue with my Shubhora account</a>
      <p className="mt-2 text-xs text-muted">Username, mobile number or email — the same password as the Shubhora app.</p>
      <div className="my-6 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />partner ID from before Sep 2026<span className="h-px flex-1 bg-line" /></div>
      <ActionForm action={memberLogin} submit="Log in with Partner ID">
        <Field label="Partner ID or mobile number" name="login" required autoComplete="username" placeholder="SH100245" />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" />
      </ActionForm>
      <p className="mt-3 text-sm"><Link href="/forgot" className="font-semibold text-brand-ink">Forgot password?</Link></p>
      <p className="mt-4 text-sm text-muted">New here? Open the card or link of the person who introduced you and tap <b>Get your own Shubhora</b> — one sign-up creates your account and your partner ID.</p>
    </AuthShell>
  );
}
