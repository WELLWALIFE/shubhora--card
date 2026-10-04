import { requireMember } from "@/server/auth/session";
import { company, memberProfile, subscriptionHistory } from "@/server/queries";
import { PrintButton } from "@/components/print-button";
import { Logo } from "@/components/ui";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "Welcome letter" };

export default async function WelcomeLetter() {
  const me = await requireMember();
  const [p, s, c] = await Promise.all([memberProfile(me.id), subscriptionHistory(me.id), company()]);
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="card p-8 sm:p-10 bg-white text-[#12144a] print:shadow-none print:border-0">
        <Logo />
        <p className="mt-8 text-sm text-[#5a5f86]">{dateFmt(new Date())}</p>
        <h1 className="mt-4 text-2xl font-extrabold">Welcome to the Shubhora partner family</h1>
        <p className="mt-4 leading-relaxed">Dear {p?.name as string},</p>
        <p className="mt-3 leading-relaxed">Thank you for joining us as an independent partner of {c.brand_name || "Shubhora"} Business Suite. Your partner details are below. Please keep them safe and do not share your password with anyone.</p>
        <table className="mt-6 w-full text-sm">
          <tbody className="[&>tr>td]:py-1.5 [&>tr>td:first-child]:text-[#5a5f86] [&>tr]:border-b [&>tr]:border-[#e0e3f1]">
            <tr><td>Username</td><td className="font-bold">{me.handle}</td></tr>
            <tr><td>Name</td><td>{p?.name as string}</td></tr>
            <tr><td>Mobile</td><td>{p?.mobile as string}</td></tr>
            <tr><td>Sponsor</td><td>{p?.sponsor_code ? `${p.sponsor_name} (${p.sponsor_code})` : "—"}</td></tr>
            <tr><td>Placement</td><td>{p?.parent_code ? `${p.parent_code}, ${p.leg === "L" ? "left" : "right"} side` : "—"}</td></tr>
            <tr><td>Joined on</td><td>{dateFmt(p?.created_at as string)}</td></tr>
            <tr><td>Activated on</td><td>{s.activation ? dateFmt(s.activation.paidOn) : "Not activated yet"}</td></tr>
          </tbody>
        </table>
        <p className="mt-6 text-sm leading-relaxed">Income depends only on genuine sales of the subscription to customers who use it. It is not guaranteed. Please read the partner agreement and never make promises about income to anyone.</p>
        <p className="mt-8 text-sm">With best wishes,<br /><b>{c.legal_name || "Wellwa Life India Pvt Ltd"}</b></p>
      </div>
    </div>
  );
}
