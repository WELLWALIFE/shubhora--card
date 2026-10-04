import { can, requireAdmin } from "@/server/auth/session";
import { company } from "@/server/queries";
import { companyAction } from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { InfoTip } from "@/components/info-tip";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Company details" };

const GROUPS: { title: string; tip: string; fields: [string, string][] }[] = [
  { title: "Invoice details", tip: "Printed on every GST invoice and credit note. The state code decides CGST + SGST (same state) or IGST (other state).",
    fields: [["legal_name", "Registered company name"], ["brand_name", "Brand name"], ["gstin", "GSTIN"], ["state_code", "State code (first 2 digits of GSTIN)"], ["pan", "Company PAN"], ["sac", "SAC code for the subscription"], ["address", "Registered address"]] },
  { title: "Support contact", tip: "Shown to members on the Support page and in reminders.",
    fields: [["support_email", "Support email"], ["support_phone", "Support phone"], ["support_whatsapp", "Support WhatsApp number"]] },
  { title: "Grievance officer", tip: "Required by the Consumer Protection (Direct Selling) Rules, 2021. Shown to every member.",
    fields: [["grievance_name", "Name"], ["grievance_email", "Email"], ["grievance_phone", "Phone"]] },
  { title: "Bank details for offline payment", tip: "Shown on the Activate page so members can pay by bank transfer or UPI when online payment is off.",
    fields: [["bank_account_name", "Account name"], ["bank_account_no", "Account number"], ["bank_ifsc", "IFSC"], ["bank_name", "Bank and branch"], ["upi_id", "UPI ID"]] },
];

export default async function Company() {
  const a = await requireAdmin();
  const c = await company();
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHead title="Company details" sub="Used on invoices, the support page and payment instructions." />
      <ActionForm action={companyAction} submit="Save company details" className="space-y-4">
        <fieldset disabled={!can(a, "plan")} className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="card p-5">
              <p className="font-bold mb-4 flex items-center gap-2">{g.title}<InfoTip title={g.title}>{g.tip}</InfoTip></p>
              <div className="grid sm:grid-cols-2 gap-3">{g.fields.map(([k, l]) => <Field key={k} label={l} name={k} defaultValue={c[k] ?? ""} />)}</div>
            </div>
          ))}
        </fieldset>
      </ActionForm>
    </div>
  );
}
