import { notFound } from "next/navigation";
import { setupTokenOk as tokenOk } from "@/server/auth/setup";
import { db } from "@/server";
import { maybeOne } from "@/server/db";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Field } from "@/components/forms";
import { ownerSetupAction } from "@/app/actions/auth";

export const metadata = { title: "Owner setup" };

// One-time page: creates the owner login when no admin exists yet. Disappears afterwards.
export default async function OwnerSetup({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!tokenOk(token) || (await maybeOne(await db(), "select 1 from admins limit 1"))) notFound();
  return (
    <AuthShell title="Create the owner login" sub="This page works once. Choose a username and a strong password only you know.">
      <ActionForm action={ownerSetupAction} submit="Create owner login">
        <input type="hidden" name="token" value={token} />
        <Field label="Your name" name="name" required />
        <Field label="Username" name="username" required autoComplete="username" />
        <Field label="Password" name="password" type="password" required autoComplete="new-password" hint="At least 12 characters" />
        <Field label="Repeat password" name="password2" type="password" required autoComplete="new-password" />
      </ActionForm>
    </AuthShell>
  );
}
