import { db } from "@/server";
import { can, requireAdmin } from "@/server/auth/session";
import { addDays, istDate } from "@/server/engine/dates";
import { settingsFor, type PlanSettings } from "@/server/engine/settings";
import { planAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/forms";
import { PageHead } from "@/components/ui";
import { dateFmt } from "@/lib/format";

export const metadata = { title: "Plan settings" };

type Def = { k: keyof PlanSettings; label: string; unit: "₹" | "%" | "BV" | "days" | "credits" | "yes/no"; div?: number };
const GROUPS: { title: string; items: Def[] }[] = [
  { title: "Volume", items: [
    { k: "bvPerSubscription", label: "BV per subscription", unit: "BV" }, { k: "pairBv", label: "BV each side for one pair", unit: "BV" },
    { k: "bvValuePaise", label: "Value of 1 BV", unit: "₹", div: 100 }, { k: "firstPairRatio", label: "First pair 2:1 or 1:2", unit: "yes/no" }] },
  { title: "Income", items: [
    { k: "directBonusBp", label: "Direct Sale Bonus (% of BV)", unit: "%", div: 100 },
    { k: "directBonusCredits", label: "Direct Sale Bonus as Shubhora AI credits (per sale)", unit: "credits" }, { k: "pairIncomePaise", label: "Income per pair", unit: "₹", div: 100 },
    { k: "dailyCapPaise", label: "Daily cap per binary", unit: "₹", div: 100 },
    { k: "binaryCeilingPaise", label: "Company ceiling: most binary payout per sale (0 = none)", unit: "₹", div: 100 }, { k: "sponsorBonusBp", label: "Sponsor Bonus (% of directs' renewal matching)", unit: "%", div: 100 },
    { k: "complimentaryEarns", label: "Complimentary IDs can earn", unit: "yes/no" }] },
  { title: "Deductions and payouts", items: [
    { k: "tdsWithPanBp", label: "TDS with PAN", unit: "%", div: 100 }, { k: "tdsWithoutPanBp", label: "TDS without PAN", unit: "%", div: 100 },
    { k: "tdsThresholdPaise", label: "TDS threshold per year", unit: "₹", div: 100 }, { k: "adminChargeBp", label: "Admin charge", unit: "%", div: 100 },
    { k: "minWithdrawalPaise", label: "Minimum withdrawal", unit: "₹", div: 100 }] },
  { title: "Subscription", items: [
    { k: "subscriptionBasePaise", label: "Subscription price (before GST)", unit: "₹", div: 100 }, { k: "gstBp", label: "GST", unit: "%", div: 100 },
    { k: "redExpiryDays", label: "Remove empty Red IDs after (0 = never)", unit: "days" },
    { k: "renewalGraceDays", label: "Grace after subscription ends (renewal income)", unit: "days" },
    { k: "renewalGraceHold", label: "Hold grace-day renewal income until the member renews", unit: "yes/no" },
    { k: "lapseStopsNewDays", label: "New-sale income stops after lapsed for (0 = never)", unit: "days" }] },
  { title: "Rank rewards", items: [
    { k: "rewardPoolBp", label: "Monthly reward pool (% of turnover)", unit: "%", div: 100 },
    { k: "rankApprovalPaise", label: "Admin approval for rewards of", unit: "₹", div: 100 }] },
];

export default async function PlanPage() {
  const a = await requireAdmin();
  const d = await db();
  const today = istDate();
  const cur = (await settingsFor(d, today)).s;
  const history = await d.query<Record<string, unknown>>(
    "select p.effective_from::text, p.note, p.created_at::text, a.username from plan_settings p left join admins a on a.id = p.created_by order by p.id desc limit 20");
  const editable = can(a, "plan");

  return (
    <div className="space-y-6">
      <PageHead title="Plan settings" sub="Every number of the plan. A change applies from a future date; past closings keep the rules they were run with." />
      <ActionForm action={planAction} submit="Save new plan version" className="space-y-5">
        <fieldset disabled={!editable} className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.title} className="card p-5">
              <p className="font-bold mb-4">{g.title}</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.items.map((it) => {
                  const v = cur[it.k];
                  return (
                    <div key={it.k}>
                      <label className="label" htmlFor={it.k}>{it.label}</label>
                      {it.unit === "yes/no" ? (
                        <select id={it.k} name={it.k} defaultValue={v ? "1" : "0"} className="input"><option value="1">Yes</option><option value="0">No</option></select>
                      ) : (
                        <div className="relative">
                          <input id={it.k} name={it.k} type="number" step="any" min={0} defaultValue={Number(v) / (it.div ?? 1)} className="input pr-12" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-faint">{it.unit}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="card p-5 grid sm:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="effective_from">Applies from</label><input id="effective_from" name="effective_from" type="date" min={addDays(today, 1)} defaultValue={addDays(today, 1)} className="input" /></div>
            <div><label className="label" htmlFor="note">Reason for the change</label><input id="note" name="note" className="input" required /></div>
          </div>
        </fieldset>
        {!editable && <p className="text-sm text-muted">Only the owner can change the plan.</p>}
      </ActionForm>
      <div className="card overflow-x-auto">
        <p className="font-bold p-4 pb-2">Versions</p>
        <table className="grid-table"><thead><tr><th>Applies from</th><th>Reason</th><th>By</th><th>Saved</th></tr></thead>
          <tbody>{history.map((h, i) => <tr key={i}><td className="font-semibold">{dateFmt(h.effective_from as string)}</td><td>{h.note as string}</td><td>{(h.username as string) ?? "system"}</td><td>{dateFmt(h.created_at as string)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
