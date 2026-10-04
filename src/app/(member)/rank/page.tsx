import { notFound } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { flags, rankInfo } from "@/server/queries";
import { n } from "@/server/db";
import { RankBadge, rankColor } from "@/components/rank-badge";
import { PageHead } from "@/components/ui";
import { dateFmt, inr } from "@/lib/format";

export const metadata = { title: "Rank" };

const STATUS: Record<string, [string, string]> = {
  paid: ["Paid", "bg-green-soft text-green"], pending: ["Upcoming", "bg-brand-soft text-brand-ink"],
  awaiting_approval: ["Being verified", "bg-amber-soft text-amber"], skipped: ["Missed (ID not active)", "bg-red-soft text-red"],
  cancelled: ["Cancelled", "bg-red-soft text-red"],
};

export default async function RankPage() {
  const me = await requireMember();
  if (!(await flags())["feature.ranks"]) notFound();
  const r = await rankInfo(me.id);
  const have = new Set(r.earned.map((e) => n(e.level)));
  const next = r.next;
  const pct = next ? Math.min(100, Math.round((Math.min(r.pairs, next.renewal_pairs) / next.renewal_pairs) * 100)) : 100;

  return (
    <div className="space-y-6">
      <PageHead title="Rank and rewards" sub="Ranks are earned on renewal pairs: customers in your team who keep using Shubhora month after month." />

      <section className="relative overflow-hidden rounded-2xl navy p-6 sm:p-8">
        <div className="absolute inset-0 navy-glow" />
        <div className="relative flex flex-wrap items-center gap-6">
          {r.current ? <RankBadge level={r.current.level} name="" size="lg" /> : <span className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-white/30 text-white/50 text-xs">No rank</span>}
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm text-white/60">Your rank</p>
            <p className="text-3xl font-extrabold tracking-tight">{r.current?.name ?? "Not ranked yet"}</p>
            {next ? (
              <>
                <p className="mt-3 text-sm text-white/75">Next: <b className="text-white">{next.name}</b> · reward <b className="text-white">{inr(next.reward_paise)}</b>{next.instalments > 1 ? ` in ${next.instalments} monthly instalments` : ""}</p>
                <div className="mt-3 h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full grad-logo" style={{ width: `${pct}%` }} /></div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <Need ok={r.pairs >= next.renewal_pairs} text={`Renewal pairs ${r.pairs.toLocaleString("en-IN")} / ${next.renewal_pairs.toLocaleString("en-IN")}`} />
                  {next.green_directs > 0 && <Need ok={r.directs >= next.green_directs} text={`Green directs ${r.directs} / ${next.green_directs}`} />}
                  <Need ok={me.status === "green"} text="Own ID green and subscription active" />
                </div>
              </>
            ) : <p className="mt-3 text-sm text-white/75">You have reached the top rank. Congratulations.</p>}
          </div>
        </div>
      </section>

      <div className="card p-5 overflow-x-auto">
        <p className="font-bold mb-5">All ranks</p>
        <div className="grid grid-cols-5 lg:grid-cols-10 gap-4 min-w-[520px]">
          {r.ranks.map((k) => <RankBadge key={k.level} level={k.level} name={k.name} dim={!have.has(k.level)} />)}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="grid-table num">
          <thead><tr><th>Rank</th><th>Renewal pairs</th><th>Green directs</th><th>Reward</th><th>Paid as</th><th>Status</th></tr></thead>
          <tbody>
            {r.ranks.map((k) => {
              const got = r.earned.find((e) => n(e.level) === k.level);
              return (
                <tr key={k.level}>
                  <td><span className="inline-flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: rankColor(k.level) }} />{k.name}</span></td>
                  <td>{k.renewal_pairs.toLocaleString("en-IN")}</td><td>{k.green_directs}</td>
                  <td className="font-semibold">{inr(k.reward_paise)}</td>
                  <td className="text-muted">{k.instalments > 1 ? `${k.instalments} × ${inr(Math.floor(k.reward_paise / k.instalments))} monthly` : "One payment"}</td>
                  <td>{got ? <span className="inline-flex items-center gap-1 text-green font-semibold"><Check className="h-4 w-4" />{dateFmt(got.achieved_on)}</span> : <span className="inline-flex items-center gap-1 text-faint"><Lock className="h-3.5 w-3.5" />Locked</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {r.instalments.length > 0 && (
        <div className="card overflow-x-auto">
          <p className="font-bold p-4 pb-2">My reward payments</p>
          <table className="grid-table num">
            <thead><tr><th>Rank</th><th>Instalment</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {r.instalments.map((i, x) => {
                const [label, cls] = STATUS[i.status as string] ?? [String(i.status), ""];
                return (
                  <tr key={x}>
                    <td>{r.ranks.find((k) => k.level === n(i.level))?.name ?? `Level ${n(i.level)}`}</td><td>{n(i.seq)}</td><td>{dateFmt(i.due_on as string)}</td>
                    <td className="font-semibold">{inr(n(i.amount_paise))}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-5 text-sm text-muted space-y-1.5">
        <p className="font-bold text-ink">How ranks work</p>
        <p>Only renewal pairs count: pairs made in the renewal binary while your own ID was green and your subscription was active (or within the 3-day grace after it ended).</p>
        <p>Each rank&apos;s reward is paid once, into your wallet, after TDS. Bigger rewards are paid in monthly instalments; an instalment is paid only if your ID is active that month.</p>
        <p>Rewards are paid from a monthly reward pool. If the pool is used up, your payment moves to the next days. Figures are the maximum payable, not a promise of income.</p>
      </div>
    </div>
  );
}

function Need({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${ok ? "text-[#7ee2a8]" : "text-white/70"}`}>{ok ? <Check className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-white/50 mx-1" />}{text}</span>;
}
