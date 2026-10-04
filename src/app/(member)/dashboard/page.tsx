import Link from "next/link";
import { ArrowRight, CalendarClock, FileCheck2, Megaphone, MessageCircle, Share2, UserPlus } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import {
  announcementsNow, binaryView, flags, incomeTotals, memberProfile, planNow, rankInfo, subscriptionHistory, teamCounts, walletBalance, type BinaryView,
} from "@/server/queries";
import { InfoTip } from "@/components/info-tip";
import { RankBadge } from "@/components/rank-badge";
import { IdBadge, Notice } from "@/components/ui";
import { withBase } from "@/lib/base";
import { bvFmt, dateFmt, INCOME_LABEL, inr } from "@/lib/format";
import { addDays } from "@/server/engine/dates";

export const metadata = { title: "Home" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string; suite?: string }> }) {
  const me = await requireMember();
  const d = await db();
  const [{ welcome, suite }, p, bin, inc, team, bal, plan, news, f, rank, sub] = await Promise.all([
    searchParams, memberProfile(me.id), binaryView(me.id), incomeTotals(me.id), teamCounts(me.id),
    walletBalance(me.id), planNow(), announcementsNow(), flags(), rankInfo(me.id), subscriptionHistory(me.id),
  ]);
  const [kyc, sponsor, recentIncome, recentTeam, lastClosing] = await Promise.all([
    maybeOne<{ status: string; reject_reason: string | null }>(d, "select status, reject_reason from kyc where member_id = $1", [me.id]),
    maybeOne<{ handle: string; mobile: string }>(d, "select coalesce(s.username, s.code) as handle, s.mobile from members m join members s on s.id = m.sponsor_id where m.id = $1", [me.id]),
    d.query<Record<string, unknown>>(`select i.kind, i.gross_paise, c.closing_date::text as day, s.code as src from incomes i join closings c on c.id = i.closing_id
      left join members s on s.id = i.source_member_id where i.member_id = $1 order by c.closing_date desc, i.id desc limit 5`, [me.id]),
    d.query<Record<string, unknown>>(`with recursive down as (select id, leg as side from members where parent_id = $1 union all select m.id, down.side from members m join down on m.parent_id = down.id)
      select m.code, m.name, m.status, down.side, m.created_at::text from down join members m on m.id = down.id order by m.id desc limit 5`, [me.id]),
    maybeOne<{ d: string | null }>(d, "select max(closing_date)::text as d from closings"),
  ]);
  const green = me.status === "green";
  const total = Object.values(inc).reduce((a, x) => a + x.total, 0);
  const last = Object.values(inc).reduce((a, x) => a + x.last, 0);
  const showBal = !!p?.show_balance && f["member.menu.wallet"];
  const subTone = sub.state === "lapsed" ? "text-red" : sub.state === "due soon" ? "text-amber" : "text-green";

  return (
    <div className="space-y-6">
      {welcome && <Notice tone="green">Your Business account <b>{me.handle}</b> is ready. Next: activate your subscription to turn it green. Your Shubhora app login is also ready: use your email and the same password at {(process.env.SUITE_PUBLIC_URL || "https://neuraledge.me").replace(/^https?:\/\//, "").replace(/\/$/, "")}.</Notice>}
      {suite && <Notice tone="red">{suite === "admin" ? "Admins cannot open a member's Shubhora account from here." : "Shubhora could not be opened right now. Please try again in a minute."}</Notice>}

      {/* ---------- hero ---------- */}
      <section className="relative overflow-hidden rounded-2xl navy p-6 sm:p-8">
        <div className="absolute inset-0 navy-glow" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm text-white/60">Welcome, {me.name.split(" ")[0]}</p>
            <p className="mt-1 text-lg font-bold">{me.handle}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3"><IdBadge status={me.status} size="lg" />
              {f["feature.ranks"] && (rank.current
                ? <Link href="/rank" className="inline-flex items-center gap-2 rounded-full bg-white/10 pl-1 pr-3 py-1 text-sm font-bold"><RankBadge level={rank.current.level} name="" size="sm" />{rank.current.name}</Link>
                : <Link href="/rank" className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/75">Next rank: {rank.next?.name}</Link>)}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-white/60">Total income</p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight num">{inr(total)}</p>
            <p className="mt-1 text-sm text-white/60">Last closing{lastClosing?.d ? ` (${dateFmt(lastClosing.d)})` : ""} <span className="font-semibold text-white">{inr(last)}</span></p>
          </div>
        </div>
        {!green ? (
          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white/8 p-4">
            <p className="text-sm text-white/80 max-w-xl"><b className="text-white">Your ID is red.</b> Activate your Shubhora Business Suite subscription ({inr(plan.subscriptionBasePaise + Math.round((plan.subscriptionBasePaise * plan.gstBp) / 10000))} a month incl. GST) to turn it green and start earning.</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/activate" className="btn bg-white text-[#12144a]">Activate now <ArrowRight className="h-4 w-4" /></Link>
              <a href={withBase("/suite")} className="btn border border-white/25 text-white hover:bg-white/10">My free basic card</a>
            </div>
          </div>
        ) : (
          <div className="relative mt-6 flex flex-wrap items-center gap-3">
            <a href={withBase("/suite")} className="btn bg-white text-[#12144a]">Open Shubhora Business Suite <ArrowRight className="h-4 w-4" /></a>
            <Link href="/activate" className="btn border border-white/25 text-white hover:bg-white/10">Renew</Link>
          </div>
        )}
      </section>

      {/* ---------- key facts ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Fact k="Activated on" v={sub.activation ? dateFmt(sub.activation.paidOn) : "Not yet"} href="/subscription" />
        <Fact k="Subscription till" v={<span className={subTone}>{dateFmt(sub.validTill)}</span>} href="/subscription"
          sub={sub.daysLeft === null ? "Activate to start" : sub.daysLeft >= 0 ? `${sub.daysLeft} days left` : `Ended ${-sub.daysLeft} days ago`}
          tip={`Renewal income and rank credit need your own subscription active.${plan.renewalGraceHold ? ` In the ${plan.renewalGraceDays} days after it ends, renewal income is held: renew within those days and it is paid, otherwise it is lost.` : ` It keeps running for ${plan.renewalGraceDays} days after it ends.`}${plan.lapseStopsNewDays > 0 ? ` After ${plan.lapseStopsNewDays} days lapsed, new-sale income stops too.` : " New-sale income does not need an active subscription."} Renewing early never loses days: the new month starts after the current one ends. A late renewal starts from the day you pay.`} />
        <Fact k="Last renewal" v={sub.lastRenewal ? dateFmt(sub.lastRenewal.paidOn) : "None yet"} href="/subscription"
          sub={sub.lastRenewal?.delayDays ? (sub.lastRenewal.delayDays > 0 ? `${sub.lastRenewal.delayDays} days late` : `${-sub.lastRenewal.delayDays} days early`) : sub.lastRenewal ? "On time" : ""} />
        <Fact k="Wallet" v={showBal ? inr(bal) : "Hidden"} href="/wallet" sub="Available to withdraw" />
        <Fact k="KYC" v={<span className={`capitalize ${kyc?.status === "approved" ? "text-green" : kyc?.status === "rejected" ? "text-red" : "text-amber"}`}>{kyc?.status ?? "Not done"}</span>} href="/kyc"
          sub={kyc?.status === "approved" ? "Withdrawals open" : "Needed for withdrawal"} />
      </div>

      {sub.state === "due soon" && <Notice tone="amber">Your subscription ends in {sub.daysLeft} days. <Link href="/activate" className="underline font-semibold">Renew now</Link> to keep your renewal income running.</Notice>}
      {sub.state === "lapsed" && green && (sub.daysLeft ?? 0) >= -plan.renewalGraceDays
        ? <Notice tone="amber">Your subscription ended {-(sub.daysLeft ?? 0)} day(s) ago. Renewal income continues for {plan.renewalGraceDays} days of grace, so renew by {dateFmt(addDays(sub.validTill!, plan.renewalGraceDays))} to lose nothing. <Link href="/activate" className="underline font-semibold">Renew now</Link></Notice>
        : sub.state === "lapsed" && green && <Notice tone="red">Your subscription has ended, so renewal income and rank credit are paused{plan.renewalGraceHold ? ` (income of the ${plan.renewalGraceDays} grace days is held until you renew)` : ""}.{plan.lapseStopsNewDays > 0 ? ` If it stays lapsed for ${plan.lapseStopsNewDays} days, new-sale income stops too.` : ""} <Link href="/activate" className="underline font-semibold">Renew now</Link></Notice>}
      {kyc?.status === "rejected" && <Notice tone="red">Your KYC was not approved: {kyc.reject_reason}. <Link href="/kyc" className="underline font-semibold">Fix and submit again</Link></Notice>}

      {/* ---------- income ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(["direct", "match_new", "match_renewal", "sponsor", "rank_reward"] as const).map((k) => (
          <Link key={k} href={`/income?t=${k}`} className="card p-4 hover:shadow-lg transition-shadow">
            <p className="text-xs font-semibold text-muted">{INCOME_LABEL[k]}</p>
            <p className="mt-1 text-xl font-bold num">{inr(inc[k].total)}</p>
            <p className="text-xs text-faint">Last closing {inr(inc[k].last)}</p>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <BinaryCard title="New sale binary" v={bin.new} cap={plan.dailyCapPaise} pairIncome={plan.pairIncomePaise} pairBv={plan.pairBv}
          tip="Every new paid subscription in your left or right team adds 2,500 BV to that side. 2,500 BV on each side makes one pair (1:1), ₹500 a pair, up to 10 pairs a day. New-sale income does not need your own subscription active." />
        <BinaryCard title="Renewal binary" v={bin.renewal} cap={plan.dailyCapPaise} pairIncome={plan.pairIncomePaise} pairBv={plan.pairBv}
          tip="Every monthly renewal in your team adds 2,500 BV here. It works like the new sale binary (1:1 pairs, ₹500 a pair, 10 pairs a day) and pays only while your own subscription is active. In the grace days after it ends, the income is held until you renew." />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm font-bold flex items-center justify-between">My team <Link href="/team" className="text-xs font-semibold text-brand-ink">Open tree →</Link></p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <TeamCell label="Left team" total={team.left} green={team.leftGreen} />
            <TeamCell label="Right team" total={team.right} green={team.rightGreen} />
            <TeamCell label="My directs" total={team.directs} green={team.directsGreen} />
            <Link href="/grow" className="rounded-xl border-2 border-dashed border-line p-3 grid place-items-center text-center text-sm font-semibold text-brand-ink hover:border-brand"><Share2 className="h-5 w-5 mb-1" />Share joining link</Link>
          </div>
          <p className="mt-4 text-xs font-semibold text-muted">Newest in your team</p>
          <ul className="mt-2 space-y-1.5">
            {recentTeam.length === 0 && <li className="text-sm text-muted">Nobody yet. Share your link from Grow.</li>}
            {recentTeam.map((r) => <li key={r.code as string} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${r.status === "green" ? "bg-green" : "bg-red"}`} />{r.name as string}</span><span className="text-xs text-faint">{r.side === "L" ? "Left" : "Right"} · {dateFmt(r.created_at as string)}</span></li>)}
          </ul>
        </div>
        <div className="card p-5">
          <p className="text-sm font-bold flex items-center justify-between">Latest income <Link href="/income" className="text-xs font-semibold text-brand-ink">All →</Link></p>
          <ul className="mt-3 divide-y divide-line">
            {recentIncome.length === 0 && <li className="py-2 text-sm text-muted">No income yet. Income is worked out every night at the closing.</li>}
            {recentIncome.map((r, i) => <li key={i} className="flex items-center justify-between py-2 text-sm"><span>{INCOME_LABEL[r.kind as string]}<span className="block text-xs text-faint">{dateFmt(r.day as string)}{r.src ? ` · from ${r.src}` : ""}</span></span><span className="font-semibold num text-green">{inr(n(r.gross_paise))}</span></li>)}
          </ul>
        </div>
        <div className="space-y-4">
          {sponsor && (
            <div className="card p-5">
              <p className="text-sm font-bold">Your sponsor</p>
              <p className="mt-2 font-semibold">{sponsor.handle}</p>
              <a href={`https://wa.me/91${sponsor.mobile}`} target="_blank" rel="noreferrer" className="mt-3 btn w-full bg-[#25D366] text-white"><MessageCircle className="h-4 w-4" />Message on WhatsApp</a>
            </div>
          )}
          <div className="card p-5">
            <p className="text-sm font-bold flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand" /> News</p>
            {news.length === 0 ? <p className="mt-3 text-sm text-muted">No announcements right now.</p> : (
              <ul className="mt-3 space-y-3">{news.map((a) => <li key={String(a.id)}><p className="text-sm font-semibold">{a.title}</p><p className="text-sm text-muted line-clamp-3">{a.body}</p></li>)}</ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Quick href="/grow" icon={<UserPlus className="h-5 w-5" />} label="Add a member" />
        <Quick href="/subscription" icon={<CalendarClock className="h-5 w-5" />} label="My subscription" />
        <Quick href="/kyc" icon={<FileCheck2 className="h-5 w-5" />} label="KYC" />
        <Quick href="/support" icon={<MessageCircle className="h-5 w-5" />} label="Get help" />
      </div>
    </div>
  );
}

function Fact({ k, v, sub, href, tip }: { k: string; v: React.ReactNode; sub?: string; href: string; tip?: string }) {
  return (
    <Link href={href} className="card p-4 hover:shadow-lg transition-shadow">
      <p className="text-xs font-semibold text-muted flex items-center gap-1.5">{k}{tip && <InfoTip title={k}>{tip}</InfoTip>}</p>
      <p className="mt-1 text-lg font-bold">{v}</p>
      {sub ? <p className="text-xs text-faint">{sub}</p> : null}
    </Link>
  );
}
function Quick({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <Link href={href} className="card flex items-center gap-3 p-4 text-sm font-semibold hover:shadow-lg"><span className="text-brand">{icon}</span>{label}</Link>;
}
function TeamCell({ label, total, green }: { label: string; total: number; green: number }) {
  return (
    <div className="rounded-xl bg-surface2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold num">{total}</p>
      <p className="text-xs"><span className="text-green font-semibold">{green} green</span> · <span className="text-red font-semibold">{total - green} red</span></p>
    </div>
  );
}
function BinaryCard({ title, v, cap, pairIncome, pairBv, tip }: { title: string; v: BinaryView; cap: number; pairIncome: number; pairBv: number; tip: string }) {
  const legs = [{ k: "Left", carry: v.carryL, today: v.todayL, total: v.totalL }, { k: "Right", carry: v.carryR, today: v.todayR, total: v.totalR }];
  const maxPairs = pairIncome ? Math.floor(cap / pairIncome) : 0;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold flex items-center gap-2">{title}<InfoTip title={title}>{tip}</InfoTip></p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${v.firstPair ? "bg-green-soft text-green" : "bg-amber-soft text-amber"}`}>{v.firstPair ? "First pair done · 1:1" : "First pair needs 2:1 or 1:2"}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {legs.map((l) => (
          <div key={l.k} className="rounded-xl border border-line p-3">
            <p className="text-xs font-semibold text-muted">{l.k} leg</p>
            <p className="mt-1 text-xl font-bold num">{bvFmt(l.carry + l.today)} <span className="text-xs font-semibold text-faint">BV</span></p>
            <p className="mt-1 text-xs text-faint num">Carry {bvFmt(l.carry)} · New today {bvFmt(l.today)}</p>
            <p className="text-xs text-faint num">Lifetime {bvFmt(l.total)}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">{bvFmt(pairBv)} BV each side = 1 pair = {inr(pairIncome)}. Up to {maxPairs} pairs ({inr(cap)}) a day. Pairs so far: <b className="num">{v.pairs}</b></p>
    </div>
  );
}
