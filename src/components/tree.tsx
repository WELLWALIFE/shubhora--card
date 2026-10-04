import Link from "next/link";
import { UserPlus } from "lucide-react";
import type { TreeNode } from "@/server/queries";
import { CenterScroll } from "./center-scroll";

const k = (bv: number) => (bv >= 100000 ? `${(bv / 100000).toFixed(1)}L` : bv >= 1000 ? `${Math.round(bv / 100) / 10}k` : String(bv));

/** Binary tree window drawn as nested rows. Each node links to itself as the new root.
 *  mode "renewal" colours by subscription (green active, amber lapsed, red never activated)
 *  and every node shows its BV in the chosen binary when `nodes[].bv` is present. */
export function BinaryTree({ nodes, rootId, hrefFor, joinHref, mode = "new" }: {
  nodes: TreeNode[]; rootId: number; hrefFor: (code: string) => string; joinHref?: (parentCode: string, leg: "L" | "R") => string; mode?: "new" | "renewal";
}) {
  const byParent = new Map<number, { L?: TreeNode; R?: TreeNode }>();
  for (const x of nodes) if (x.parent !== null) {
    const s = byParent.get(x.parent) ?? {};
    s[x.leg as "L" | "R"] = x;
    byParent.set(x.parent, s);
  }
  const root = nodes.find((x) => x.id === rootId);
  if (!root) return null;
  const maxDepth = Math.max(...nodes.map((x) => x.depth));

  const tone = (x: TreeNode) => (x.status !== "green" ? "red" : mode === "renewal" && !x.subActive ? "amber" : "green");
  const TONE = { green: "bg-green ring-green-soft", red: "bg-red ring-red-soft", amber: "bg-amber ring-amber-soft" } as const;

  function Slot({ node, parent, leg, level }: { node?: TreeNode; parent?: TreeNode; leg: "L" | "R"; level: number }) {
    if (!node) {
      return (
        <div className="flex flex-col items-center w-[104px]">
          {parent && joinHref ? (
            <Link href={joinHref(parent.handle, leg)} className="grid h-11 w-11 place-items-center rounded-full border-2 border-dashed border-line text-faint hover:border-brand hover:text-brand" title={`Add on ${leg === "L" ? "left" : "right"} of ${parent.code}`}>
              <UserPlus className="h-4 w-4" />
            </Link>
          ) : <div className="h-11 w-11 rounded-full border-2 border-dashed border-line opacity-50" />}
          <p className="mt-1 text-[10px] text-faint">Empty</p>
        </div>
      );
    }
    return <Node node={node} level={level} />;
  }

  function Node({ node, level }: { node: TreeNode; level: number }) {
    const kids = byParent.get(node.id) ?? {};
    const t = tone(node);
    const b = node.bv;
    const tm = node.team;
    // Plain-text fallback (native tooltip) for keyboards / long-press; the styled card below is what the mouse shows.
    const title = [`User Name: ${node.handle}`, `S. User Name: ${node.sponsor || "—"}`, `Green  L ${tm.greenL} | R ${tm.greenR}`, `Red  L ${tm.redL} | R ${tm.redR}`,
      ...(b ? [`Lifetime BV  L ${b.L.toLocaleString("en-IN")} | R ${b.R.toLocaleString("en-IN")}`, `Carry BV  L ${b.carryL.toLocaleString("en-IN")} | R ${b.carryR.toLocaleString("en-IN")}`, `Pairs ${b.pairs}`] : [])].join("\n");
    return (
      <div className="flex flex-col items-center">
        <Link href={hrefFor(node.handle)} title={title} className="group/node relative flex w-[104px] flex-col items-center">
        {/* Hover card (owner's layout, 23 Sep 2026): username, sponsor's username, then green / red IDs in the left and right team. */}
          <div className={`pointer-events-none absolute left-1/2 z-30 hidden w-[210px] ${level >= maxDepth ? "bottom-14" : "top-12"} -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-left text-[11px] shadow-float group-hover/node:block`}>
            <p className="truncate"><span className="text-muted">User Name:</span> <b>{node.handle}</b> <span className="text-faint">· {node.name}</span></p>
            <p className="truncate"><span className="text-muted">S. User Name:</span> <b>{node.sponsor || "—"}</b></p>
            <table className="mt-2 w-full num">
              <thead><tr className="text-[10px] uppercase tracking-wide text-faint"><th className="text-left font-medium"></th><th className="text-right font-medium">Left ID</th><th className="text-right font-medium">Right ID</th></tr></thead>
              <tbody>
                <tr><td className="py-0.5"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green" />Green</td><td className="text-right font-semibold">{tm.greenL}</td><td className="text-right font-semibold">{tm.greenR}</td></tr>
                <tr><td className="py-0.5"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red" />Red</td><td className="text-right font-semibold">{tm.redL}</td><td className="text-right font-semibold">{tm.redR}</td></tr>
              </tbody>
            </table>
            {b && <p className="mt-2 border-t border-line pt-1.5 text-[10px] text-muted">BV L {b.L.toLocaleString("en-IN")} | R {b.R.toLocaleString("en-IN")} · carry L {b.carryL.toLocaleString("en-IN")} | R {b.carryR.toLocaleString("en-IN")} · {b.pairs} pairs</p>}
          </div>

          <span className={`grid h-11 w-11 place-items-center rounded-full text-xs font-bold text-white ring-4 ${TONE[t]} group-hover/node:scale-105 transition-transform`}>
            {node.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          {/* Only the username under the ID (owner's call, 23 Sep 2026) — the name is in the hover card and the lists. */}
          <span className="mt-1.5 max-w-[100px] truncate text-[11px] font-semibold">{node.handle}</span>
          {b && (
            <span className="mt-1 rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold num leading-tight text-center">
              <span className="text-muted">L</span> {k(b.L)} <span className="text-faint">|</span> <span className="text-muted">R</span> {k(b.R)}
              <span className="block text-[9px] font-medium text-faint">{b.pairs} pairs</span>
            </span>
          )}
        </Link>
        {level < maxDepth && (
          <div className="mt-3 flex gap-1 sm:gap-3 relative pt-3 before:absolute before:top-0 before:left-1/4 before:right-1/4 before:h-px before:bg-line after:absolute after:-top-3 after:left-1/2 after:h-3 after:w-px after:bg-line">
            <div className="relative before:absolute before:-top-3 before:left-1/2 before:h-3 before:w-px before:bg-line"><Slot node={kids.L} parent={node} leg="L" level={level + 1} /></div>
            <div className="relative before:absolute before:-top-3 before:left-1/2 before:h-3 before:w-px before:bg-line"><Slot node={kids.R} parent={node} leg="R" level={level + 1} /></div>
          </div>
        )}
      </div>
    );
  }

  return <CenterScroll className="overflow-x-auto pb-2"><div className="min-w-max mx-auto flex justify-center px-2"><Node node={root} level={0} /></div></CenterScroll>;
}

/** Colour key shown under a tree. */
export function TreeLegend({ mode }: { mode: "new" | "renewal" }) {
  const dot = (c: string, l: string) => <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${c}`} />{l}</span>;
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      {mode === "new" ? <>{dot("bg-green", "Green ID (paid)")}{dot("bg-red", "Red ID (not activated)")}</>
        : <>{dot("bg-green", "Subscription active")}{dot("bg-amber", "Subscription lapsed")}{dot("bg-red", "Never activated")}</>}
      <span>L | R = lifetime BV in each leg of this binary. Hover or tap for carry forward.</span>
    </div>
  );
}
