import QRCode from "qrcode";
import { db } from "@/server";
import { maybeOne } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { otpauthUrl } from "@/server/auth/totp";
import { adminPasswordAction, totpConfirmAction, totpDisableAction, totpStartAction } from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { Notice, PageHead } from "@/components/ui";

export const metadata = { title: "My security" };

export default async function Security() {
  const a = await requireAdmin();
  const row = await maybeOne<{ totp_secret: string | null; totp_enabled: boolean }>(await db(), "select totp_secret, totp_enabled from admins where id = $1", [a.id]);
  const pending = row?.totp_secret && !row.totp_enabled;
  const qr = pending ? await QRCode.toDataURL(otpauthUrl(row!.totp_secret!, a.username), { margin: 1, width: 240 }) : null;
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHead title="My security" sub={`Logged in as ${a.username}`} />
      <div className="card p-6">
        <p className="font-bold">Two-step login</p>
        <p className="mt-1 text-sm text-muted">After your password, you also enter a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or Authy). Strongly recommended for the owner and accounts staff.</p>
        <div className="mt-4">
          {row?.totp_enabled ? (
            <>
              <Notice tone="green">Two-step login is on.</Notice>
              <div className="mt-4 max-w-sm"><ActionForm action={totpDisableAction} submit="Turn off" danger><Field label="Current 6-digit code" name="code" inputMode="numeric" required /></ActionForm></div>
            </>
          ) : pending ? (
            <div className="grid sm:grid-cols-[240px_1fr] gap-6 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr!} alt="Scan with your authenticator app" className="rounded-xl border border-line bg-white p-2" />
              <div className="space-y-3">
                <p className="text-sm">1. Open your authenticator app and scan this code.</p>
                <p className="text-sm text-muted">Can&apos;t scan? Enter this key: <span className="font-mono text-ink break-all">{row!.totp_secret}</span></p>
                <p className="text-sm">2. Type the 6-digit code it shows.</p>
                <ActionForm action={totpConfirmAction} submit="Turn on two-step login"><Field label="6-digit code" name="code" inputMode="numeric" required /></ActionForm>
              </div>
            </div>
          ) : (
            <form action={totpStartAction}><button className="btn btn-primary">Set up two-step login</button></form>
          )}
        </div>
      </div>
      <div className="card p-6">
        <p className="font-bold mb-4">Change password</p>
        <ActionForm action={adminPasswordAction} submit="Change password" className="space-y-4 max-w-sm">
          <Field label="Current password" name="current" type="password" required autoComplete="current-password" />
          <Field label="New password" name="password" type="password" required autoComplete="new-password" hint="At least 10 characters" />
          <Field label="Repeat new password" name="password2" type="password" required autoComplete="new-password" />
        </ActionForm>
      </div>
    </div>
  );
}
