import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, LogIn, MessageCircle } from "lucide-react";
import { db } from "@/server";
import { maybeOne, n } from "@/server/db";
import { can, requireAdmin } from "@/server/auth/session";
import { binaryView, incomeTotals, memberProfile, memberTimeline, rankInfo, subscriptionHistory, teamCounts, treeWindow, uplinePath } from "@/server/queries";
import { available } from "@/server/engine/wallet";
import { memberByCode } from "@/server/engine/members";
import {
  adjustWalletAction, adminKycEditAction, changeSponsorAction, editMemberAction, generatePasswordAction, loginAsAction,
  makeGreenAction, movePlacementAction, noteAction, refundAction, renewOfflineAction, suiteSyncAction, toggleAction,
} from "@/app/actions/admin";
import { ActionForm, Field } from "@/components/forms";
import { InfoTip } from "@/components/info-tip";
import { RankBadge } from "@/components/rank-badge";
import { BinaryTree, TreeLegend } from "@/components/tree";
import { TreeTabs } from "@/components/tree-tabs";
import { IdBadge } from "@/components/ui";
import { withBase } from "@/lib/base";
import { bvFmt, dateFmt, INCOME_LABEL, inr, LEDGER_LABEL, dateTimeFmt } from "@/lib/format";

export const metadata = { title: "Member" };

const TABS = [["overview", "Overview"], ["subscription", "Subscription"], ["income", "Income & wallet"], ["team", "Team & tree"],
  ["kyc", "KYC & documents"], ["history", "History"], ["manage", "Manage"]] as const;

const dt = (s: string | null | undefined) => dateTimeFmt(s);

export default async function MemberDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string; bin?: string }> }) {
  const a = await requireAdmin();
  const [{ code }, { tab = "overview", bin: bp }] = await Promise.all([params, searchParams]);
  const tree = bp === "renewal" ? "renewal" : "new";
  const d = await db();
  const ref = await memberByCode(d, code);
  if (!ref) notFound();
  const id = n(ref.id);
  const [p, inc, bin, team, bal, rank, sub, kyc, upline] = await Promise.all([
    memberProfile(id), incomeTotals(id), binaryView(id), teamCounts(id), available(d, id), rankInfo(id), subscriptionHistory(id),
    maybeOne<Record<string, unknown>>(d, "select *, submitted_at::text as sub_at, reviewed_at::text as rev_at from kyc where member_id = $1", [id]),
    uplinePath(id),
  ]);
  if (!p) notFound();
  const extra = await maybeOne<Record<string, unknown>>(d, "select last_login_at::text, last_login_ip, photo_file from members where id = $1", [id]);
  const notes = await d.query<Record<string, unknown>>("select n.body, n.pinned, n.at::text, a.username from member_notes n left join admins a on a.id = n.admin_id where member_id = $1 order by pinned desc, n.id desc limit 5", [id]);
  const green = p.status === "green";
  const money = can(a, "money"); const edit = can(a, "members"); const owner = can(a, "plan");
  const subTone = sub.state === "lapsed" ? "text-red" : sub.state === "due soon" ? "text-amber" : "text-green";
  const href = (t: string) => `/admin/members/${p.code}?tab=${t}`;

  return (
    <div className="space-y-5">
      <Link href="/admin/members" className="text-sm text-muted hover:text-ink">← Members</Link>

      {/* ---------- header: who, status, key dates, quick actions ---------- */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start gap-4">
          {extra?.photo_file
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={withBase(`/files/${extra.photo_file}`)} alt="" className="h-16 w-16 rounded-2xl object-cover" />
            : <span className={`grid h-16 w-16 place-items-center rounded-2xl text-xl font-bold text-white ${green ? "bg-green" : "bg-red"}`}>{String(p.name).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{p.name as string}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-semibold">{p.code as string}</span><IdBadge status={p.status as string} />
              {p.green_kind ? <span className="rounded bg-surface2 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-muted">{p.green_kind === "paid" ? "paid online" : p.green_kind as string}</span> : null}
              {rank.current && <span className="inline-flex items-center gap-1.5 text-xs font-bold"><RankBadge level={rank.current.level} name="" size="sm" />{rank.current.name}</span>}
              {p.blocked ? <span className="rounded bg-red-soft px-2 py-0.5 text-xs font-bold text-red">Blocked</span> : null}
              {p.income_hold ? <span className="rounded bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber">Income on hold</span> : null}
              {p.withdraw_block ? <span className="rounded bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber">Withdrawals blocked</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted">{p.mobile as string}{p.email ? ` · ${p.email}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {edit && <form action={loginAsAction}><input type="hidden" name="member" value={id} /><button className="btn btn-primary"><LogIn className="h-4 w-4" />Open member panel</button></form>}
            <a href={`https://wa.me/91${p.mobile}`} target="_blank" rel="noreferrer" className="btn bg-[#25D366] text-white"><MessageCircle className="h-4 w-4" />WhatsApp</a>
            <Link href={href("manage")} className="btn btn-ghost">Manage</Link>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <Fact k="Joined" v={dateFmt(p.created_at as string)} />
          <Fact k="Activated" v={sub.activation ? dateFmt(sub.activation.paidOn) : "Not yet"} tip="The date the first subscription was paid and the ID turned green." />
          <Fact k="Subscription till" v={<span className={subTone}>{dateFmt(sub.validTill)}</span>}
            sub={sub.daysLeft === null ? "" : sub.daysLeft >= 0 ? `${sub.daysLeft} days left` : `ended ${-sub.daysLeft} days ago`} />
          <Fact k="Last renewal" v={sub.lastRenewal ? dateFmt(sub.lastRenewal.paidOn) : "None yet"}
            sub={sub.lastRenewal?.delayDays ? (sub.lastRenewal.delayDays > 0 ? `${sub.lastRenewal.delayDays} days late` : `${-sub.lastRenewal.delayDays} days early`) : sub.lastRenewal ? "on time" : ""}
            tip="Late = paid after the previous month had already ended. Renewal income is not paid for days the subscription was not active." />
          <Fact k="Wallet" v={inr(bal)} sub={p.show_balance ? "" : "hidden from member"} />
          <Fact k="Last login" v={extra?.last_login_at ? dt(extra.last_login_at as string) : "Never"} sub={(extra?.last_login_ip as string) ?? ""} />
        </div>
      </section>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {TABS.map(([k, l]) => <Link key={k} href={href(k)} className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold ${tab === k ? "bg-brand text-white" : "text-muted hover:bg-surface2 hover:text-ink"}`}>{l}</Link>)}
      </nav>

      {tab === "overview" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card p-5 text-sm space-y-2">
            <p className="font-bold text-base mb-2">Details</p>
            <Info k="Sponsor" v={p.sponsor_code ? <Link className="text-brand-ink" href={`/admin/members/${p.sponsor_code}`}>{p.sponsor_name as string} · {p.sponsor_code as string}</Link> : "—"} />
            <Info k="Placed under" v={p.parent_code ? <Link className="text-brand-ink" href={`/admin/members/${p.parent_code}`}>{p.parent_code as string} · {p.leg === "L" ? "Left" : "Right"}</Link> : "Top"} />
            <Info k="Level in tree" v={String(p.depth)} />
            <Info k="KYC" v={kyc ? String(kyc.status) : "Not submitted"} />
            <Info k="PAN" v={(p.pan as string) ?? "—"} />
            <Info k="Shubhora login" v={p.suite_email ? String(p.suite_email) : p.email ? "Not created yet" : "No email on file"} />
            <div className="pt-2 text-xs text-muted">Upline: {upline.map((u, i) => <span key={u.code}>{i > 0 && " › "}<Link href={`/admin/members/${u.code}`} className="text-brand-ink font-mono">{u.code}</Link></span>)}</div>
          </div>
          <div className="card p-5 text-sm">
            <p className="font-bold text-base mb-3">Income</p>
            {(["direct", "match_new", "match_renewal", "sponsor", "rank_reward"] as const).map((k) => <Info key={k} k={INCOME_LABEL[k]} v={inr(inc[k].total)} />)}
            <div className="border-t border-line mt-2 pt-2"><Info k="Total" v={<b>{inr(Object.values(inc).reduce((x, y) => x + y.total, 0))}</b>} /></div>
            <Link href={href("income")} className="mt-3 inline-block text-sm font-semibold text-brand-ink">Wallet statement →</Link>
          </div>
          <div className="card p-5 text-sm">
            <p className="font-bold text-base mb-3">Team and rank</p>
            <Info k="Left team" v={`${team.left} (${team.leftGreen} green)`} /><Info k="Right team" v={`${team.right} (${team.rightGreen} green)`} />
            <Info k="Directs" v={`${team.directs} (${team.directsGreen} green)`} />
            <Info k="Renewal pairs (rank)" v={rank.pairs.toLocaleString("en-IN")} />
            <Info k="Next rank" v={rank.next ? `${rank.next.name} at ${rank.next.renewal_pairs.toLocaleString("en-IN")} pairs` : "Top rank"} />
            <Link href={href("team")} className="mt-3 inline-block text-sm font-semibold text-brand-ink">Open tree →</Link>
          </div>
          <div className="card p-5 lg:col-span-3">
            <div className="flex items-center justify-between mb-3"><p className="font-bold flex items-center gap-2">Staff notes <InfoTip title="Staff notes">Only staff see these. Use them for call notes, promises made to the member, or anything the next person should know.</InfoTip></p><Link href={href("history")} className="text-sm font-semibold text-brand-ink">Full history →</Link></div>
            {notes.length === 0 ? <p className="text-sm text-muted mb-3">No notes yet.</p> : (
              <ul className="space-y-2 mb-4">{notes.map((x, i) => <li key={i} className={`rounded-lg px-3 py-2 text-sm ${x.pinned ? "bg-amber-soft" : "bg-surface2"}`}>{x.body as string}<span className="block text-xs text-faint mt-0.5">{(x.username as string) ?? "staff"} · {dt(x.at as string)}</span></li>)}</ul>
            )}
            {edit && <ActionForm action={noteAction} submit="Add note" className="flex flex-wrap gap-2 [&>button]:w-auto">
              <input type="hidden" name="member" value={id} /><input name="body" className="input flex-1 min-w-60" placeholder="Write a note for the team" required />
              <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" name="pinned" /> Pin</label>
            </ActionForm>}
          </div>
        </div>
      )}

      {tab === "subscription" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Fact card k="Activated on" v={sub.activation ? dateFmt(sub.activation.paidOn) : "Not yet"} />
            <Fact card k="Renewals paid" v={String(sub.renewalsCount)} />
            <Fact card k="Late renewals" v={String(sub.lateCount)} sub={sub.lateCount ? `average ${sub.avgDelay} days late` : ""} />
            <Fact card k="Valid till" v={dateFmt(sub.validTill)} />
            <Fact card k="Status" v={<span className={`capitalize ${subTone}`}>{sub.state}</span>} />
          </div>
          {money && green && (
            <div className="card p-5 max-w-xl">
              <p className="font-bold mb-3 flex items-center gap-2">Record a renewal paid offline <InfoTip title="Offline renewal">Use this when the member paid by cash, cheque or bank transfer. It extends the subscription by one month from the current end date, creates the GST invoice and adds the plan&apos;s BV (2,500) to the renewal binary.</InfoTip></p>
              <ActionForm action={renewOfflineAction} submit="Record renewal"><input type="hidden" name="member" value={id} />
                <div className="grid sm:grid-cols-2 gap-3"><Field label="Bank or cash reference" name="reference" required /><Field label="Reason" name="reason" required /></div>
              </ActionForm>
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="grid-table">
              <thead><tr><th>Paid on</th><th>Type</th><th>Method</th><th>Period</th><th>On time?</th><th>Amount</th><th>Invoice</th><th>Reference</th><th>Status</th>{money && <th>Refund</th>}</tr></thead>
              <tbody>
                {sub.rows.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-muted">No payments yet.</td></tr>}
                {sub.rows.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{dateFmt(x.paidOn)}</td><td className="capitalize">{x.kind}</td><td className="capitalize">{x.method}</td>
                    <td className="whitespace-nowrap">{dateFmt(x.from)} – {dateFmt(x.to)}</td>
                    <td>{x.delayDays === null ? "—" : x.delayDays > 0 ? <span className="font-semibold text-red">{x.delayDays} days late</span> : <span className="text-green">{x.delayDays < 0 ? `${-x.delayDays} days early` : "On time"}</span>}</td>
                    <td className="num">{inr(x.total)}</td>
                    <td className="font-mono text-xs">{x.invoice ? <Link className="text-brand-ink" href={`/invoice/${x.id}`} target="_blank">{x.invoice}</Link> : "—"}</td>
                    <td className="font-mono text-xs">{x.reference ?? "—"}</td>
                    <td className={x.status === "paid" ? "text-green font-semibold" : "text-red font-semibold"}>{x.status}</td>
                    {money && <td>{x.status === "paid" && <ActionForm action={refundAction} submit="Refund" danger className="flex flex-wrap items-start gap-2 [&>button]:w-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap [&>p]:basis-full"><input type="hidden" name="payment" value={x.id} /><input name="reason" placeholder="Reason" required className="input w-32" /></ActionForm>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "income" && <IncomeTab id={id} bal={bal} />}

      {tab === "team" && <TeamTab id={id} bin={bin} code={p.code as string} tree={tree} />}

      {tab === "kyc" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card p-5 text-sm space-y-2">
            <p className="font-bold text-base mb-2">KYC details</p>
            {!kyc ? <p className="text-muted">Not submitted yet.</p> : <>
              <Info k="Status" v={<span className="capitalize font-semibold">{String(kyc.status)}</span>} />
              <Info k="PAN" v={`${kyc.pan} · ${kyc.pan_name}`} /><Info k="Aadhaar" v={kyc.aadhaar_last4 ? `XXXX XXXX ${kyc.aadhaar_last4}` : "—"} />
              <Info k="Bank" v={`${kyc.bank_name} · ${kyc.account_name}`} /><Info k="Account / IFSC" v={`${kyc.account_no} · ${kyc.ifsc}`} />
              <Info k="Nominee" v={(kyc.nominee as string) || "—"} /><Info k="GSTIN" v={(kyc.gstin as string) || "—"} />
              <Info k="Address" v={(kyc.address as string) || "—"} /><Info k="Submitted" v={dt(kyc.sub_at as string)} /><Info k="Reviewed" v={dt(kyc.rev_at as string)} />
              {kyc.reject_reason ? <p className="text-red text-xs">{kyc.reject_reason as string}</p> : null}
              <Link href="/admin/kyc" className="inline-block pt-2 font-semibold text-brand-ink">Approve or reject in KYC review →</Link>
            </>}
          </div>
          <div className="card p-5">
            <p className="font-bold mb-3">Documents</p>
            {kyc ? <div className="grid grid-cols-2 gap-3">
              {([["pan_file", "PAN card"], ["bank_file", "Cheque or passbook"], ["aadhaar_front_file", "Aadhaar front"], ["aadhaar_back_file", "Aadhaar back"]] as const).map(([k, l]) => (
                <Doc key={k} label={l} id={kyc[k] as string | null} />
              ))}
            </div> : <p className="text-sm text-muted">No documents yet.</p>}
          </div>
          {kyc && can(a, "kyc") && (
            <div className="card p-5 lg:col-span-2">
              <p className="font-bold mb-3 flex items-center gap-2">Change bank details <InfoTip title="Bank change">Only after the member asks in writing and you have checked a cancelled cheque or passbook. The old details are kept in the activity log.</InfoTip></p>
              <ActionForm action={adminKycEditAction} submit="Save bank details"><input type="hidden" name="member" value={id} />
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Field label="Account holder" name="account_name" defaultValue={kyc.account_name as string} required />
                  <Field label="Bank name" name="bank_name" defaultValue={kyc.bank_name as string} required />
                  <Field label="Account number" name="account_no" defaultValue={kyc.account_no as string} required />
                  <Field label="IFSC" name="ifsc" defaultValue={kyc.ifsc as string} required />
                </div>
                <Field label="Reason" name="reason" required />
              </ActionForm>
            </div>
          )}
        </div>
      )}

      {tab === "history" && <HistoryTab id={id} />}

      {tab === "manage" && (
        <div className="grid lg:grid-cols-2 gap-4">
          {edit && (
            <Panel title="Password" tip="Passwords are stored locked; nobody, not even the owner, can read them. Create a new one, then send it to the member on WhatsApp. Their old logins are signed out.">
              <ActionForm action={generatePasswordAction} submit="Create new password"><input type="hidden" name="member" value={id} />
                <Field label="Reason (optional)" name="reason" placeholder="Member forgot password" />
              </ActionForm>
            </Panel>
          )}
          {money && !green && (
            <Panel title="Make green" tip="Paid offline: the member paid by cash or bank transfer. This creates BV, the GST invoice and income for the team. Complimentary: for staff or demo IDs. No BV and nobody earns on it.">
              <ActionForm action={makeGreenAction} submit="Make green">
                <input type="hidden" name="member" value={id} />
                <div><label className="label" htmlFor="kind">Type</label>
                  <select id="kind" name="kind" className="input">
                    <option value="offline">Paid offline (cash or bank transfer)</option>
                    <option value="complimentary">Complimentary (staff or demo)</option>
                  </select></div>
                <Field label="Bank or cash reference (for paid offline)" name="reference" />
                <Field label="Reason" name="reason" required />
              </ActionForm>
            </Panel>
          )}
          {edit && (
            <Panel title="Controls" tip="Block ID: the member cannot log in and earns nothing. Hold income: income is worked out but kept aside until you release it. Block withdrawals: income comes in but cannot be withdrawn. Show wallet balance: hide or show the balance on the member's screens.">
              <div className="space-y-3">
                {([["blocked", "Block ID", !!p.blocked], ["income_hold", "Hold income", !!p.income_hold], ["withdraw_block", "Block withdrawals", !!p.withdraw_block], ["show_balance", "Show wallet balance to member", !!p.show_balance]] as const).map(([field, label, on]) => (
                  <ActionForm key={field} action={toggleAction} submit={`${on ? "Turn off" : "Turn on"}: ${label}`} className="flex flex-wrap items-end gap-2 [&>button]:w-auto">
                    <input type="hidden" name="member" value={id} /><input type="hidden" name="field" value={field} /><input type="hidden" name="value" value={on ? "0" : "1"} />
                    <input name="reason" placeholder="Reason" className="input flex-1 min-w-40" required />
                  </ActionForm>
                ))}
              </div>
            </Panel>
          )}
          {money && (
            <Panel title="Wallet adjustment" tip="For corrections only. Staff changes wait for the owner's approval; the member sees the note in their statement.">
              <ActionForm action={adjustWalletAction} submit="Save adjustment">
                <input type="hidden" name="member" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label" htmlFor="direction">Type</label><select id="direction" name="direction" className="input"><option value="credit">Credit</option><option value="debit">Debit</option></select></div>
                  <Field label="Amount in rupees" name="amount" required inputMode="numeric" />
                </div>
                <Field label="Note (member sees this)" name="note" required />
              </ActionForm>
            </Panel>
          )}
          {edit && (
            <Panel title="Edit name, mobile, email">
              <ActionForm action={editMemberAction} submit="Save details">
                <input type="hidden" name="member" value={id} />
                <Field label="Name" name="name" defaultValue={p.name as string} required />
                <div className="grid grid-cols-2 gap-3"><Field label="Mobile" name="mobile" defaultValue={p.mobile as string} required /><Field label="Email" name="email" defaultValue={(p.email as string) ?? ""} /></div>
                <Field label="Reason" name="reason" required />
              </ActionForm>
            </Panel>
          )}
          {edit && (
            <Panel title="Shubhora Business Suite" tip="Each payment turns on one month of Shubhora Business Suite on the member's email. If it did not go through (for example no email), fix the email and press Sync.">
              <p className="text-sm text-muted mb-3">Login: <b className="text-ink">{(p.suite_email as string) ?? "not created"}</b></p>
              <ActionForm action={suiteSyncAction} submit="Sync now"><input type="hidden" name="member" value={id} /></ActionForm>
            </Panel>
          )}
          {owner && (
            <Panel title="Change sponsor" tip="Changes who receives this member's future direct-sale credits and bonuses. Nothing already paid changes. The tree position (placement) stays the same.">
              <ActionForm action={changeSponsorAction} submit="Change sponsor"><input type="hidden" name="member" value={id} />
                <div className="grid grid-cols-2 gap-3"><Field label="New sponsor ID" name="sponsor" required /><Field label="Reason" name="reason" required /></div>
              </ActionForm>
            </Panel>
          )}
          {owner && (
            <Panel title="Move in the tree" tip="Allowed only while nobody is placed under this ID and its volume has not been counted in a closing yet, so no one else's legs change. Choose an empty left or right position.">
              <ActionForm action={movePlacementAction} submit="Move"><input type="hidden" name="member" value={id} />
                <div className="grid grid-cols-3 gap-3"><Field label="New placement ID" name="parent" required />
                  <div><label className="label" htmlFor="leg">Side</label><select id="leg" name="leg" className="input"><option value="L">Left</option><option value="R">Right</option></select></div>
                  <Field label="Reason" name="reason" required /></div>
              </ActionForm>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

async function IncomeTab({ id, bal }: { id: number; bal: number }) {
  const d = await db();
  const ledger = await d.query<Record<string, unknown>>("select entry, amount_paise, note, created_at::text from ledger where member_id = $1 order by id desc limit 300", [id]);
  const incomes = await d.query<Record<string, unknown>>(
    `select i.kind, i.gross_paise, i.held, c.closing_date::text as day, s.code as src from incomes i join closings c on c.id = i.closing_id
     left join members s on s.id = i.source_member_id where i.member_id = $1 order by c.closing_date desc, i.id desc limit 300`, [id]);
  const wds = await d.query<Record<string, unknown>>("select amount_paise, status, utr, requested_at::text from withdrawals where member_id = $1 order by id desc", [id]);
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card overflow-x-auto">
        <p className="font-bold p-4 pb-2">Wallet statement · balance {inr(bal)}</p>
        <table className="grid-table"><thead><tr><th>Date</th><th>Entry</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{ledger.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No entries.</td></tr>}
            {ledger.map((l, i) => { const x = n(l.amount_paise); return <tr key={i}><td className="whitespace-nowrap">{dateFmt(l.created_at as string)}</td><td>{LEDGER_LABEL[l.entry as string]}</td><td className="text-muted">{(l.note as string) ?? ""}</td><td className={`text-right num font-semibold ${x < 0 ? "text-red" : "text-green"}`}>{x < 0 ? "−" : "+"}{inr(Math.abs(x))}</td></tr>; })}
          </tbody></table>
      </div>
      <div className="space-y-4">
        <div className="card overflow-x-auto">
          <p className="font-bold p-4 pb-2">Income</p>
          <table className="grid-table"><thead><tr><th>Closing</th><th>Income</th><th>From</th><th className="text-right">Gross</th></tr></thead>
            <tbody>{incomes.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No income yet.</td></tr>}
              {incomes.map((r, i) => <tr key={i}><td>{dateFmt(r.day as string)}</td><td>{INCOME_LABEL[r.kind as string]}{r.held ? " (held)" : ""}</td><td className="font-mono text-xs">{(r.src as string) ?? "Team"}</td><td className="text-right num">{inr(n(r.gross_paise))}</td></tr>)}
            </tbody></table>
        </div>
        <div className="card overflow-x-auto">
          <p className="font-bold p-4 pb-2">Withdrawals</p>
          <table className="grid-table"><thead><tr><th>Requested</th><th>Amount</th><th>Status</th><th>UTR</th></tr></thead>
            <tbody>{wds.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">None.</td></tr>}
              {wds.map((w, i) => <tr key={i}><td>{dateFmt(w.requested_at as string)}</td><td className="num">{inr(n(w.amount_paise))}</td><td className="capitalize">{w.status as string}</td><td className="font-mono text-xs">{(w.utr as string) ?? "—"}</td></tr>)}
            </tbody></table>
        </div>
      </div>
    </div>
  );
}

async function TeamTab({ id, bin, code, tree }: { id: number; bin: Awaited<ReturnType<typeof binaryView>>; code: string; tree: "new" | "renewal" }) {
  const d = await db();
  const nodes = await treeWindow(id, 3, tree);
  const directs = await d.query<Record<string, unknown>>(
    "select code, name, status, mobile, sub_valid_until::text, created_at::text from members where sponsor_id = $1 order by id desc limit 200", [id]);
  const lines = await d.query<Record<string, unknown>>(
    "select l.*, c.closing_date::text as day from closing_lines l join closings c on c.id = l.closing_id where l.member_id = $1 order by c.closing_date desc, l.bin limit 60", [id]);
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        {(["new", "renewal"] as const).map((b) => (
          <div key={b} className="card p-5 text-sm num">
            <p className="font-bold mb-2">{b === "new" ? "New sale binary" : "Renewal binary"} <span className="text-xs font-semibold text-muted">{bin[b].firstPair ? "· first pair done" : "· first pair pending"}</span></p>
            <Info k="Carry left / right" v={`${bvFmt(bin[b].carryL + bin[b].todayL)} / ${bvFmt(bin[b].carryR + bin[b].todayR)} BV`} />
            <Info k="New today (not closed)" v={`${bvFmt(bin[b].todayL)} / ${bvFmt(bin[b].todayR)} BV`} />
            <Info k="Lifetime left / right" v={`${bvFmt(bin[b].totalL)} / ${bvFmt(bin[b].totalR)} BV`} />
            <Info k="Pairs so far" v={String(bin[b].pairs)} />
          </div>
        ))}
      </div>
      <div className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><TreeTabs bin={tree} hrefFor={(b) => `/admin/members/${code}?tab=team&bin=${b}`} /><Link href={`/admin/tree?root=${code}&bin=${tree}`} className="text-sm font-semibold text-brand-ink">Full tree viewer →</Link></div>
        <BinaryTree nodes={nodes} rootId={id} hrefFor={(c) => `/admin/members/${c}?tab=team&bin=${tree}`} mode={tree} />
        <TreeLegend mode={tree} /></div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card overflow-x-auto">
          <p className="font-bold p-4 pb-2">Directs ({directs.length})</p>
          <table className="grid-table"><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Subscription till</th></tr></thead>
            <tbody>{directs.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No directs yet.</td></tr>}
              {directs.map((r) => <tr key={r.code as string}><td><Link href={`/admin/members/${r.code}`} className="font-mono text-brand-ink">{r.code as string}</Link></td><td>{r.name as string}</td><td><IdBadge status={r.status as string} /></td><td>{dateFmt(r.sub_valid_until as string)}</td></tr>)}
            </tbody></table>
        </div>
        <div className="card overflow-x-auto">
          <p className="font-bold p-4 pb-2">Pair details by closing</p>
          <table className="grid-table num"><thead><tr><th>Date</th><th>Binary</th><th>New L/R</th><th>Pairs</th><th>Paid</th><th>Carry L/R</th><th>Note</th></tr></thead>
            <tbody>{lines.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">No closings yet.</td></tr>}
              {lines.map((l, i) => <tr key={i}><td>{dateFmt(l.day as string)}</td><td>{l.bin === "new" ? "New" : "Renewal"}</td><td>{bvFmt(n(l.in_left))}/{bvFmt(n(l.in_right))}</td><td>{n(l.pairs)}</td><td>{n(l.paid_pairs)}</td><td>{bvFmt(n(l.close_left))}/{bvFmt(n(l.close_right))}</td><td className="text-muted text-xs">{(l.reason as string) ?? ""}</td></tr>)}
            </tbody></table>
        </div>
      </div>
    </div>
  );
}

const KIND_DOT: Record<string, string> = { joined: "bg-brand", payment: "bg-green", refund: "bg-red", rank: "bg-amber", kyc: "bg-brand", withdrawal: "bg-green", admin: "bg-muted", login: "bg-faint", note: "bg-amber" };

async function HistoryTab({ id }: { id: number }) {
  const items = await memberTimeline(id);
  return (
    <div className="card p-5">
      <p className="font-bold mb-4 flex items-center gap-2">Everything that happened to this ID <InfoTip title="History">Registrations, payments, refunds, ranks, KYC, withdrawals, logins, staff actions and notes, newest first.</InfoTip></p>
      <ol className="relative border-l border-line ml-2 space-y-4">
        {items.map((x, i) => (
          <li key={i} className="ml-5">
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${KIND_DOT[x.kind] ?? "bg-faint"}`} />
            <p className="text-sm">{x.text}</p>
            <p className="text-xs text-faint">{dt(x.at)}{x.by ? ` · by ${x.by}` : ""}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Fact({ k, v, sub, tip, card }: { k: string; v: React.ReactNode; sub?: string; tip?: string; card?: boolean }) {
  return (
    <div className={card ? "card p-4" : "rounded-xl bg-surface2 p-3"}>
      <p className="text-xs font-semibold text-muted flex items-center gap-1.5">{k}{tip && <InfoTip title={k}>{tip}</InfoTip>}</p>
      <p className="mt-1 font-bold">{v}</p>
      {sub ? <p className="text-xs text-faint mt-0.5">{sub}</p> : null}
    </div>
  );
}
function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-0.5"><span className="text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>;
}
function Panel({ title, tip, children }: { title: string; tip?: string; children: React.ReactNode }) {
  return <div className="card p-5"><p className="font-bold mb-4 flex items-center gap-2">{title}{tip && <InfoTip title={title}>{tip}</InfoTip>}</p>{children}</div>;
}
function Doc({ label, id }: { label: string; id: string | null }) {
  return (
    <div className="rounded-xl border border-line p-2 text-xs">
      <p className="font-semibold mb-1.5">{label}</p>
      {id ? <a href={withBase(`/files/${id}`)} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBase(`/files/${id}`)} alt={label} className="h-28 w-full rounded-lg object-cover bg-surface2" />
        <span className="mt-1 inline-flex items-center gap-1 text-brand-ink">Open <ExternalLink className="h-3 w-3" /></span>
      </a> : <p className="text-faint">Not uploaded</p>}
    </div>
  );
}
