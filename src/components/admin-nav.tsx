"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeIndianRupee, BarChart3, CalendarCheck2, FileCheck2, FileSpreadsheet, Headphones, LayoutDashboard,
  Megaphone, ScrollText, Settings2, ShieldCheck, ToggleRight, Users, CheckCheck, KeyRound, Award, RefreshCw, GitFork, Receipt, LockKeyhole, Building2, Download, History, Zap,
} from "lucide-react";

const GROUPS = [
  { title: "Overview", items: [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: "view" },
  ] },
  { title: "Members", items: [
    { href: "/admin/members", label: "Members", icon: Users, perm: "view" },
    { href: "/admin/activate", label: "Activate IDs", icon: Zap, perm: "money" },
    { href: "/admin/tree", label: "Tree", icon: GitFork, perm: "view" },
    { href: "/admin/renewals", label: "Renewals", icon: RefreshCw, perm: "view" },
    { href: "/admin/kyc", label: "KYC", icon: FileCheck2, perm: "kyc" },
    { href: "/admin/ranks", label: "Ranks", icon: Award, perm: "view" },
  ] },
  { title: "Money", items: [
    { href: "/admin/closing", label: "Daily closing", icon: CalendarCheck2, perm: "view" },
    { href: "/admin/payment-requests", label: "Payment requests", icon: Receipt, perm: "reports" },
    { href: "/admin/payments", label: "Payments", icon: BadgeIndianRupee, perm: "reports" },
    { href: "/admin/withdrawals", label: "Withdrawals", icon: BarChart3, perm: "money" },
    { href: "/admin/approvals", label: "Approvals", icon: CheckCheck, perm: "money" },
    { href: "/admin/reports", label: "Reports & CA", icon: FileSpreadsheet, perm: "reports" },
  ] },
  { title: "Help desk", items: [
    { href: "/admin/support", label: "Support", icon: Headphones, perm: "support" },
    { href: "/admin/passwords", label: "Password requests", icon: LockKeyhole, perm: "members" },
    { href: "/admin/news", label: "News", icon: Megaphone, perm: "support" },
    { href: "/admin/downloads", label: "Downloads", icon: Download, perm: "support" },
  ] },
  { title: "Settings", items: [
    { href: "/admin/plan", label: "Plan settings", icon: Settings2, perm: "view" },
    { href: "/admin/company", label: "Company details", icon: Building2, perm: "view" },
    { href: "/admin/controls", label: "Show / hide", icon: ToggleRight, perm: "plan" },
    { href: "/admin/staff", label: "Staff", icon: ShieldCheck, perm: "staff" },
    { href: "/admin/audit", label: "Activity log", icon: ScrollText, perm: "view" },
    { href: "/admin/logins", label: "Login history", icon: History, perm: "view" },
    { href: "/admin/security", label: "My security", icon: KeyRound, perm: "view" },
  ] },
] as const;

export function AdminNav({ allowed }: { allowed: string[] }) {
  const path = usePathname();
  const active = (h: string) => (h === "/admin" ? path === h : path.startsWith(h));
  return (
    <nav className="flex lg:flex-col gap-1 lg:gap-4 overflow-x-auto lg:overflow-visible">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => allowed.includes(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.title} className="flex lg:flex-col gap-1 shrink-0">
            <p className="hidden lg:block px-3 text-[10.5px] font-bold uppercase tracking-[.14em] text-white/35">{g.title}</p>
            {items.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${active(href) ? "bg-white/12 text-white" : "text-white/60 hover:text-white hover:bg-white/6"}`}>
                <Icon className="h-4 w-4" />{label}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
