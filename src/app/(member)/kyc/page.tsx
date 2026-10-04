import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { maybeOne } from "@/server/db";
import { kycAction } from "@/app/actions/member";
import { ActionForm, Field } from "@/components/forms";
import { Notice, PageHead } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";
import { UploadField } from "@/components/upload";

export const metadata = { title: "KYC" };

export default async function KycPage() {
  const me = await requireMember();
  const k = await maybeOne<Record<string, string | null>>(await db(), "select * from kyc where member_id = $1", [me.id]);
  const v = (x: string) => (k?.[x] as string) ?? undefined;
  return (
    <div className="max-w-2xl space-y-6">
      <PageHead title="KYC" sub="Needed for withdrawals and for correct TDS. Your details are visible only to the KYC team." />
      {k?.status === "approved" && <Notice tone="green">Your KYC is approved. To change bank details, raise a support ticket.</Notice>}
      {k?.status === "pending" && <Notice tone="amber">Your KYC is under review.</Notice>}
      {k?.status === "rejected" && <Notice tone="red">Your KYC was not approved: {k.reject_reason}. Correct the details and submit again.</Notice>}
      {k?.status !== "approved" && (
        <div className="card p-6">
          <ActionForm action={kycAction} submit={k ? "Submit again" : "Submit KYC"}>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="PAN" name="pan" required defaultValue={v("pan")} placeholder="ABCDE1234F" />
              <Field label="Name on PAN" name="pan_name" required defaultValue={v("pan_name")} />
              <Field label="Aadhaar number (optional)" name="aadhaar" inputMode="numeric" hint="Only the last 4 digits are stored." />
              <Field label="GSTIN (if registered)" name="gstin" defaultValue={v("gstin")} />
            </div>
            <p className="pt-2 text-sm font-bold">Bank account</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Account holder name" name="account_name" required defaultValue={v("account_name")} />
              <Field label="Bank name" name="bank_name" required defaultValue={v("bank_name")} />
              <Field label="Account number" name="account_no" required inputMode="numeric" />
              <Field label="Repeat account number" name="account_no2" required inputMode="numeric" />
              <Field label="IFSC" name="ifsc" required defaultValue={v("ifsc")} placeholder="SBIN0001234" />
              <Field label="Nominee (optional)" name="nominee" defaultValue={v("nominee")} />
            </div>
            <Field label="Address (optional)" name="address" defaultValue={v("address")} />
            <p className="pt-2 text-sm font-bold flex items-center gap-2">Documents <InfoTip title="Photos of documents">Take a clear photo with your phone. Big photos are reduced automatically before upload, so it is quick even on mobile data. PAN and cheque or passbook are required; Aadhaar is optional.</InfoTip></p>
            <div className="grid sm:grid-cols-2 gap-4">
              <UploadField name="pan_file" kind="kyc_pan" label="PAN card (required)" current={v("pan_file")} accept="image/*,application/pdf" />
              <UploadField name="bank_file" kind="kyc_bank" label="Cancelled cheque or passbook (required)" current={v("bank_file")} accept="image/*,application/pdf" />
              <UploadField name="aadhaar_front_file" kind="kyc_aadhaar_front" label="Aadhaar front (optional)" current={v("aadhaar_front_file")} />
              <UploadField name="aadhaar_back_file" kind="kyc_aadhaar_back" label="Aadhaar back (optional)" current={v("aadhaar_back_file")} />
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
