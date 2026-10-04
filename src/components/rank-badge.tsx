import { Award } from "lucide-react";

// One colour per level, walking the Shubhora logo gradient from cyan to orange, then gold for the top ranks.
const COLORS = ["#19c8f0", "#1aa6ef", "#2f5bf5", "#4a45f0", "#6a3cf0", "#9a36e0", "#c02fd9", "#e0357f", "#ff6a2a", "#f5a500"];

export const rankColor = (level: number) => COLORS[Math.min(Math.max(level, 1), COLORS.length) - 1];

export function RankBadge({ level, name, size = "md", dim = false }: { level: number; name: string; size?: "sm" | "md" | "lg"; dim?: boolean }) {
  const c = rankColor(level);
  const box = { sm: "h-8 w-8", md: "h-12 w-12", lg: "h-20 w-20" }[size];
  const icon = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-10 w-10" }[size];
  return (
    <span className={`inline-flex flex-col items-center gap-1.5 ${dim ? "opacity-40 grayscale" : ""}`}>
      <span className={`grid ${box} place-items-center rounded-full text-white shadow-lg`} style={{ background: `radial-gradient(circle at 30% 25%, #ffffff55, transparent 45%), ${c}`, boxShadow: `0 8px 24px -8px ${c}` }}>
        <Award className={icon} />
      </span>
      {size !== "sm" && <span className="text-xs font-bold text-center leading-tight">{name}</span>}
    </span>
  );
}
