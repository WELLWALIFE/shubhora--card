export const metadata = { title: "Partner agreement" };

export default function Agreement() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 space-y-4 text-[15px] leading-relaxed">
      <h1 className="text-2xl font-bold">Partner agreement</h1>
      <p className="text-sm text-muted">Draft. The final text will be provided by the company&apos;s legal advisor before launch.</p>
      <ol className="list-decimal pl-5 space-y-2">
        <li>Registration is free. There is no joining fee.</li>
        <li>Income is earned only on paid Shubhora Business Suite subscriptions bought by real customers, as set out in the published plan.</li>
        <li>Income is not guaranteed. The figures in the plan are the maximum payable, not a promise.</li>
        <li>One person may hold one ID. Duplicate IDs may be closed and their income forfeited.</li>
        <li>TDS is deducted as per the Income Tax Act. Withdrawals need approved KYC.</li>
        <li>If a payment is refunded, the volume and the income paid on it are reversed.</li>
        <li>The partner must not make false claims about the product or the income.</li>
        <li>Complaints can be raised through Support; the grievance officer&apos;s details are shown there.</li>
      </ol>
    </div>
  );
}
