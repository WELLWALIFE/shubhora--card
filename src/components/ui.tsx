import { withBase } from "@/lib/base";

export function Logo({ light = false, sub }: { light?: boolean; sub?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBase("/brand/shubhora-mark.png")} alt="" width={24} height={30} className="h-8 w-auto" />
      <span className="leading-none">
        <span className={`block text-[1.1rem] font-extrabold tracking-tight ${light ? "text-white" : "text-ink"}`}>Shubhora</span>
        <span className={`block text-[10.5px] font-semibold uppercase tracking-[.14em] mt-0.5 ${light ? "text-white/60" : "text-faint"}`}>{sub ?? "User Panel"}</span>
      </span>
    </span>
  );
}

export function IdBadge({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
  const green = status === "green";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"} ${green ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
      <span className={`rounded-full ${size === "lg" ? "h-2.5 w-2.5" : "h-2 w-2"} ${green ? "bg-green" : "bg-red"}`} />
      {green ? "Green ID" : "Red ID"}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "red" | "brand" }) {
  const color = tone === "green" ? "text-green" : tone === "red" ? "text-red" : tone === "brand" ? "text-brand-ink" : "text-ink";
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight num ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-muted">{children}</div>;
}

export function Notice({ tone = "brand", children }: { tone?: "brand" | "red" | "green" | "amber"; children: React.ReactNode }) {
  const cls = { brand: "bg-brand-soft text-brand-ink", red: "bg-red-soft text-red", green: "bg-green-soft text-green", amber: "bg-amber-soft text-amber" }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm font-medium ${cls}`}>{children}</div>;
}
