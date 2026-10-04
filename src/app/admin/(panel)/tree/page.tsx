import Link from "next/link";
import { db } from "@/server";
import { n } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { memberByCode } from "@/server/engine/members";
import { binaryView, teamCounts, treeWindow, uplinePath } from "@/server/queries";
import { BinaryTree, TreeLegend } from "@/components/tree";
import { TreeTabs } from "@/components/tree-tabs";
import { InfoTip } from "@/components/info-tip";
import { Notice, PageHead } from "@/components/ui";
import { bvFmt } from "@/lib/format";

export const metadata = { title: "Tree" };

export default async function TreeViewer({ searchParams }: { searchParams: Promise<{ root?: string; depth?: string; bin?: string }> }) {
  await requireAdmin();
  const { root, depth, bin: bp } = await searchParams;
  const bin = bp === "renewal" ? "renewal" : "new";
  const d = await db();
  const top = (await d.query<{ code: string }>("select code from members where parent_id is null limit 1"))[0]?.code ?? "";
  const m = await memberByCode(d, root || top);
  const levels = Math.min(5, Math.max(2, Number(depth) || 3));
  if (!m) return <div className="space-y-5"><PageHead title="Tree" /><Notice tone="red">ID {root} not found.</Notice></div>;
  const id = n(m.id);
  const [nodes, up, team, bv] = await Promise.all([treeWindow(id, levels, bin), uplinePath(id), teamCounts(id), binaryView(id)]);
  const extreme = async (leg: "L" | "R") => (await d.query<{ code: string }>(
    `with recursive c as (select id, code, 0 as s from members where id = $1 union all select x.id, x.code, c.s + 1 from members x join c on x.parent_id = c.id and x.leg = $2)
     select code from c order by s desc limit 1`, [id, leg]))[0]?.code;
  const [el, er] = await Promise.all([extreme("L"), extreme("R")]);

  return (
    <div className="space-y-5">
      <PageHead title="Tree viewer" sub="Click any ID to make it the top of the view.">
        <form className="flex gap-2"><input type="hidden" name="bin" value={bin} /><input name="root" defaultValue={root ?? ""} placeholder="Go to ID" className="input w-36" />
          <select name="depth" defaultValue={String(levels)} className="input w-28" aria-label="Levels">{[2, 3, 4, 5].map((x) => <option key={x} value={x}>{x} levels</option>)}</select>
          <button className="btn btn-primary">Go</button></form>
      </PageHead>
      <div className="card p-4 text-sm flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-muted">Upline: {up.map((u, i) => <span key={u.code}>{i > 0 && " › "}<Link className="font-mono text-brand-ink" href={`/admin/tree?root=${u.code}&depth=${levels}&bin=${bin}`}>{u.code}</Link></span>)}</span>
        <span>Left {team.left} ({team.leftGreen} green) · Right {team.right} ({team.rightGreen} green)</span>
        <span className="num">{bin === "new" ? "New-sale" : "Renewal"} carry L {bvFmt(bv[bin].carryL + bv[bin].todayL)} / R {bvFmt(bv[bin].carryR + bv[bin].todayR)}</span>
        <span>Bottom: {el && <Link className="font-mono text-brand-ink" href={`/admin/tree?root=${el}&depth=${levels}&bin=${bin}`}>left {el}</Link>} · {er && <Link className="font-mono text-brand-ink" href={`/admin/tree?root=${er}&depth=${levels}&bin=${bin}`}>right {er}</Link>}</span>
        <InfoTip title="Extreme left and right" align="right">The bottom of each outer leg is where a new ID lands when someone joins with the left or right link of this ID.</InfoTip>
        <Link href={`/admin/members/${m.code}`} className="ml-auto font-semibold text-brand-ink">Open {m.code} →</Link>
      </div>
      <div className="card p-5">
        <div className="mb-5"><TreeTabs bin={bin} hrefFor={(b) => `/admin/tree?root=${m.code}&depth=${levels}&bin=${b}`} /></div>
        <BinaryTree nodes={nodes} rootId={id} hrefFor={(c) => `/admin/tree?root=${c}&depth=${levels}&bin=${bin}`} mode={bin} />
        <TreeLegend mode={bin} />
      </div>
    </div>
  );
}
