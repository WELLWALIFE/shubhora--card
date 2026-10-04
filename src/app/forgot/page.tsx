import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Field } from "@/components/forms";
import { forgotAction } from "@/app/actions/auth";

export const metadata = { title: "Forgot password" };

export default function Forgot() {
  return (
    <AuthShell title="Forgot your password?" sub="Tell us your partner ID or registered mobile number. The company will send you a new password on WhatsApp.">
      <ActionForm action={forgotAction} submit="Request a new password">
        <Field label="Partner ID or registered mobile" name="login" required autoComplete="username" />
        <Field label="Message for the team (optional)" name="message" placeholder="Best time to reach me" />
      </ActionForm>
      <p className="mt-6 text-sm"><Link href="/login" className="font-semibold text-brand-ink">Back to log in</Link></p>
    </AuthShell>
  );
}
