import Link from "next/link";
import { company, planNow } from "@/server/queries";
import { inr } from "@/lib/format";

export const metadata = { title: "Partner programme disclosures" };
export const dynamic = "force-dynamic";

// Public disclosures for the partner (associate) programme, as the Consumer Protection (Direct Selling) Rules, 2021
// ask a direct selling entity to publish. Company details come from Admin → Company details, with the defaults below.
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid sm:grid-cols-[210px_1fr] gap-1 border-b border-line px-4 py-2.5 last:border-0"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>;
}

export default async function Disclosures() {
  const [c, p] = await Promise.all([company(), planNow()]);
  const legal = c.legal_name || "Wellwa Life India Pvt Ltd";
  const brand = c.brand_name || "Shubhora";
  const address = c.address || "704, 7th Floor, Palm Court, Gurgaon, Haryana 122007";
  const email = c.support_email || "support@shubhora.com";
  const phone = c.support_phone || "+91 76656 69888";
  const gName = c.grievance_name || "Mr. R. Kumar";
  const gEmail = c.grievance_email || email;
  const gPhone = c.grievance_phone || phone;
  const price = p.subscriptionBasePaise;
  const gst = Math.round((price * p.gstBp) / 10000);
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 space-y-8 text-[15px] leading-relaxed">
      <div>
        <h1 className="text-2xl font-bold">Partner programme disclosures</h1>
        <p className="mt-2 text-sm text-muted">Published as required by the Consumer Protection (Direct Selling) Rules, 2021.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">The company</h2>
        <dl className="card text-sm">
          <Row k="Legal name" v={legal} />
          <Row k="Brand" v={brand} />
          <Row k="Registered office" v={address} />
          {c.gstin ? <Row k="GSTIN" v={c.gstin} /> : null}
          {c.pan ? <Row k="PAN" v={c.pan} /> : null}
          <Row k="Email" v={email} />
          <Row k="Phone" v={phone} />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">What partners offer</h2>
        <p>Partners introduce customers to the {brand} Business Suite, a monthly software subscription (website, daily posters, social media posting, WhatsApp AI assistant and lead CRM). The subscription price is {inr(price)} + GST ({inr(gst)}) = {inr(price + gst)} a month. The same price applies to every customer and partner.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Key terms</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b>No joining fee.</b> Registration as a partner is free. Nobody has to buy anything to join.</li>
          <li><b>Income only from real sales.</b> Commission is paid only on paid subscriptions by real customers, and renewals of those subscriptions. There is no income for recruiting people as such.</li>
          <li><b>No stock, no inventory.</b> The product is software; partners never buy or hold stock.</li>
          <li><b>Income is not guaranteed.</b> Figures in the plan are the most that can be paid, not a promise.</li>
          <li><b>Refunds.</b> A customer can cancel and ask for a refund as per the published refund policy. When a payment is refunded, the commission paid on it is reversed.</li>
          <li><b>Tax and KYC.</b> TDS is deducted under the Income Tax Act. Withdrawals need approved KYC (PAN and bank account).</li>
          <li><b>Honest selling.</b> Partners must not make false or misleading claims about the product or about income. Breaking this can end the partnership.</li>
          <li><b>Identity.</b> Every partner has a unique ID and a written agreement. One person may hold one ID.</li>
        </ul>
        <p className="text-sm"><Link href="/legal/agreement" className="font-semibold text-brand-ink">Read the partner agreement</Link> · <a href="/refund" className="font-semibold text-brand-ink">Refund policy</a></p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Grievance Officer</h2>
        <dl className="card text-sm">
          <Row k="Name" v={gName} />
          <Row k="Email" v={gEmail} />
          <Row k="Phone" v={gPhone} />
          <Row k="Address" v={address} />
        </dl>
        <p className="text-sm text-muted">Partners and customers can also raise a ticket under Support after logging in. We acknowledge a complaint within 48 hours and resolve it within one month.</p>
      </section>
    </div>
  );
}
