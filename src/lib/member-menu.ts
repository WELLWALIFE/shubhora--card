// The member menu, shared by the navigation (client) and the More page (server).
import {
  Award, BadgeIndianRupee, CalendarClock, CircleUserRound, Download, FileCheck2, Headphones, House, Network, Share2, Wallet,
} from "lucide-react";

export const MEMBER_MENU = [
  { href: "/dashboard", label: "Home", icon: House, flag: null, main: true },
  { href: "/team", label: "Team", icon: Network, flag: "member.menu.team", main: true },
  { href: "/grow", label: "Grow", icon: Share2, flag: "member.menu.grow", main: false },
  { href: "/income", label: "Income", icon: BadgeIndianRupee, flag: "member.menu.income", main: true },
  { href: "/wallet", label: "Wallet", icon: Wallet, flag: "member.menu.wallet", main: true },
  { href: "/rank", label: "Rank", icon: Award, flag: "member.menu.rank", main: false },
  { href: "/subscription", label: "Subscription", icon: CalendarClock, flag: "member.menu.subscription", main: false },
  { href: "/kyc", label: "KYC", icon: FileCheck2, flag: "member.menu.kyc", main: false },
  { href: "/downloads", label: "Downloads", icon: Download, flag: "member.menu.downloads", main: false },
  { href: "/support", label: "Support", icon: Headphones, flag: "member.menu.support", main: false },
  { href: "/profile", label: "Profile", icon: CircleUserRound, flag: null, main: false },
] as const;

export const visibleMenu = (enabled: Record<string, boolean>) =>
  MEMBER_MENU.filter((i) => (!i.flag || enabled[i.flag]) && (i.href !== "/rank" || enabled["feature.ranks"]));

