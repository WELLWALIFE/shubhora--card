import Link from "next/link";
import { FileText, LogOut, Smartphone } from "lucide-react";
import { withBase } from "@/lib/base";
import { requireMember } from "@/server/auth/session";
import { flags } from "@/server/queries";
import { memberLogout } from "@/app/actions/auth";
import { visibleMenu } from "@/lib/member-menu";
import { PageHead } from "@/components/ui";

export const metadata = { title: "More" };

export default async function More() {
  await requireMember();
  const items = visibleMenu(await flags()).filter((i) => !i.main);
  return (
    <div className="space-y-5">
      <PageHead title="More" />
      <div className="grid grid-cols-3 gap-3">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="card flex flex-col items-center gap-2 p-4 text-center text-sm font-semibold hover:shadow-lg"><Icon className="h-6 w-6 text-brand" />{label}</Link>
        ))}
        <Link href="/welcome-letter" className="card flex flex-col items-center gap-2 p-4 text-center text-sm font-semibold hover:shadow-lg"><FileText className="h-6 w-6 text-brand" />Welcome letter</Link>
        {/* The Shubhora app (posters, card, WhatsApp AI) — same account, opened without a second login. Plain <a>: a full page load, same tab. */}
        <a href={withBase("/suite")} className="card flex flex-col items-center gap-2 p-4 text-center text-sm font-semibold hover:shadow-lg"><Smartphone className="h-6 w-6 text-brand" />Shubhora app</a>
      </div>
      <form action={memberLogout}><button className="btn btn-ghost w-full"><LogOut className="h-4 w-4" />Log out</button></form>
    </div>
  );
}
