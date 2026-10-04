import Link from "next/link";
import { Search } from "lucide-react";
import { requireMember } from "@/server/auth/session";
import { db } from "@/server";
import { n } from "@/server/db";
import { isInTeam, treeWindow } from "@/server/queries";
import { memberByCode } from "@/server/engine/members";
import { BinaryTree, TreeLegend } from "@/components/tree";
import { TreeTabs } from "@/components/tree-tabs";
import { IdBadge, Notice, PageHead } from "@/components/ui";
import { dateFmt } from "@/lib/format";
import { istDate } from "@/server/engine/dates";
import { InfoTip } from "@/components/info-tip";
import { withBase } from "@/lib/base";

export const metadata = { title: "Team" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ root?: string; q?: string; list?: string; bin?: string }> }) {
  const me = await requireMember();
  const { root, q, list, bin: binParam } = await searchParams;
  const bin = binParam === "renewal" ? "renewal" : "new";
  const d = await db();
  const today = istDate();

  let rootId = me.id;
  let notFound = false;
  const wanted = q || root;
  if (wanted) {
    const m = await memberByCode(d, wanted);
    if (m && (await isInTeam(me.id, n(m.id)))) rootId = n(m.id); else notFound = true;
  }
  const nodes = await treeWindow(rootId, 3, bin);
  const current = nodes.find((x) => x.id === rootId)!;

  const tab = list === "left" || list === "right" ? list : "directs";
  const rows = tab === "directs"
    ? await d.query<Record<string, unknown>>(
        "select code, coalesce(username, code) as handle, name, status, mobile, created_at::date::text as joined, green_date::text, sub_valid_until::text from members where sponsor_id = $1 order by id desc limit 200", [me.id])
    : await d.query<Record<string, unknown>>(
        `with recursive down as (
           select id from members where parent_id = $1 and leg = $2
           union all select m.id from members m join down on m.parent_id = down.id)
         select m.code, coalesce(m.username, m.code) as handle, m.name, m.status, m.mobile, m.created_at::date::text as joined, m.green_date::text, m.sub_valid_until::text
         from down join members m on m.id = down.id order by m.id desc limit 200`, [me.id, tab === "left" ? "L" : "R"]);

  return (
    <div className="space-y-6">
      <PageHead title="My team" sub="Green IDs have an active subscription. Red IDs are registered but not yet active.">
        <a href={withBase("/me/export?type=team")} className="btn btn-ghost">Download (Excel)</a>
        <InfoTip title="Reading the tree" align="right">Your left and right teams are everyone placed under you on each side, whoever introduced them. Tap a person to see the tree from their position. A dashed circle is an empty spot. Lapsed means their subscription ended: remind them to renew so your renewal binary keeps growing.</InfoTip>
        <form className="flex gap-2">
          <input name="q" placeholder="Search by username" defaultValue={q} className="input w-40" />
          <button className="btn btn-ghost" aria-label="Search"><Search className="h-4 w-4" /></button>
        </form>
      </PageHead>
      {notFound && <Notice tone="red">That username is not in your team.</Notice>}

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <TreeTabs bin={bin} hrefFor={(b) => `/team?bin=${b}${rootId !== me.id ? `&root=${current.handle}` : ""}`} />
          <p className="text-sm font-semibold">Showing from <span className="font-semibold">{current.handle}</span> · {current.name}</p>
          {rootId !== me.id && <Link href="/team" className="text-sm font-semibold text-brand-ink">Back to my position</Link>}
        </div>
        <BinaryTree nodes={nodes} rootId={rootId} hrefFor={(c) => `/team?bin=${bin}&root=${c}`} mode={bin}
          joinHref={(p, leg) => `/grow?parent=${p}&leg=${leg}`} />
        <TreeLegend mode={bin} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex gap-1 border-b border-line p-2">
          {[["directs", "My directs"], ["left", "Left team"], ["right", "Right team"]].map(([k, l]) => (
            <Link key={k} href={`/team?list=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-surface2"}`}>{l}</Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead><tr><th>Username</th><th>Name</th><th>Status</th><th>Joined</th><th>Activated</th><th>Subscription till</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-8">Nobody here yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.code as string}>
                  <td><Link href={`/team?root=${r.handle}`} className="font-semibold text-brand-ink">{r.handle as string}</Link></td>
                  <td>{r.name as string}</td>
                  <td><IdBadge status={r.status as string} />{r.status !== "green" && <Link href={`/activate?for=${r.code}`} className="block mt-1 text-xs font-semibold text-brand-ink">Pay for this ID</Link>}</td>
                  <td>{dateFmt(r.joined as string)}</td>
                  <td>{dateFmt(r.green_date as string)}</td>
                  <td className={r.sub_valid_until && String(r.sub_valid_until) < today ? "text-red font-semibold" : ""}>{dateFmt(r.sub_valid_until as string)}{r.sub_valid_until && String(r.sub_valid_until) < today ? " · lapsed" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
