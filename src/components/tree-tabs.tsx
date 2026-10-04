import Link from "next/link";
import { InfoTip } from "./info-tip";

/** Switch between the New Sale tree and the Renewal tree. */
export function TreeTabs({ bin, hrefFor }: { bin: "new" | "renewal"; hrefFor: (b: "new" | "renewal") => string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-xl border border-line bg-surface p-1">
        {(["new", "renewal"] as const).map((b) => (
          <Link key={b} href={hrefFor(b)} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold ${bin === b ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>
            {b === "new" ? "New sale tree" : "Renewal tree"}
          </Link>
        ))}
      </div>
      <InfoTip title="Two trees, one team">Both trees have the same people in the same places: you place a member once. What differs is the volume. The New sale tree counts 2,500 BV when someone activates. The Renewal tree counts 2,500 BV every time someone renews their monthly subscription. Each tree makes its own pairs and pays up to ₹5,000 a day.</InfoTip>
    </div>
  );
}
