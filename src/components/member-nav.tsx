"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid2x2 } from "lucide-react";
import { visibleMenu } from "@/lib/member-menu";

export function MemberNav({ enabled }: { enabled: Record<string, boolean> }) {
  const path = usePathname();
  const items = visibleMenu(enabled);
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const mobile = items.filter((i) => i.main);
  const moreActive = !mobile.some((i) => active(i.href));
  return (
    <>
      <nav className="hidden lg:flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${active(href) ? "bg-white/12 text-white" : "text-white/60 hover:text-white hover:bg-white/6"}`}>
            <Icon className="h-[18px] w-[18px]" />{label}
          </Link>
        ))}
      </nav>
      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {mobile.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active(href) ? "text-brand" : "text-faint"}`}>
              <Icon className="h-5 w-5" />{label}
            </Link>
          ))}
          <Link href="/more" className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${moreActive ? "text-brand" : "text-faint"}`}><Grid2x2 className="h-5 w-5" />More</Link>
        </div>
      </nav>
    </>
  );
}
