import Link from "next/link";

// Single-series daily bars (one hue, so no legend needed). Each bar has a native hover tooltip with the exact value;
// the headline total sits above the chart. Bars are anchored to the baseline with rounded top corners and 2px gaps.
export function MiniBars({ title, data, href, unit = "" }: { title: string; data: { day: string; value: number }[]; href?: string; unit?: string }) {
  const W = 300; const H = 72;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = W / Math.max(1, data.length);
  const total = data.reduce((a, d) => a + d.value, 0);
  const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const body = (
    <div className="card p-4 h-full transition-shadow hover:shadow-lg">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{title}</p>
        <p className="text-xs text-faint">last {data.length} days</p>
      </div>
      <p className="mt-1 text-2xl font-bold num">{total.toLocaleString("en-IN")}{unit}</p>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="mt-2 w-full h-auto" role="img" aria-label={`${title}: ${total} in the last ${data.length} days`}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" strokeWidth="1" />
        {data.map((d, i) => {
          const h = d.value ? Math.max(3, (d.value / max) * (H - 4)) : 0;
          const x = i * bw + 1; const w = Math.max(1, bw - 2);
          return (
            <g key={d.day}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent"><title>{`${label(d.day)}: ${d.value.toLocaleString("en-IN")}${unit}`}</title></rect>
              {h > 0 && <path d={`M${x},${H} v${-(h - Math.min(2, w / 2))} q0,-2 2,-2 h${w - 4 > 0 ? w - 4 : 0} q2,0 2,2 v${h - Math.min(2, w / 2)} z`} fill="var(--brand)" pointerEvents="none" />}
            </g>
          );
        })}
        <text x="0" y={H + 12} fontSize="9" fill="var(--faint)">{data[0] ? label(data[0].day) : ""}</text>
        <text x={W} y={H + 12} fontSize="9" fill="var(--faint)" textAnchor="end">{data.length ? label(data[data.length - 1].day) : ""}</text>
      </svg>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
