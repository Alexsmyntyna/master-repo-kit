import { weeklyCommits, type WeekSnapshot } from "@/lib/sparkline";

// Commits per week over the last 12 weeks as small columns (lib/sparkline.ts), inline SVG. The current week is the
// last column and the brightest; a quiet week is a baseline tick; a week the snapshot hasn't read is a faint dot.
// With no snapshot, a faint dash.
export function Sparkline({ snapshot, weeks = 12, today }: { snapshot: WeekSnapshot | null | undefined; weeks?: number; today?: Date | string }) {
  const data = weeklyCommits(snapshot, weeks, today);
  if (!data.length) return <span className="spark spark-none" title="No git snapshot read">—</span>;
  const max = Math.max(1, ...data.map((n) => n ?? 0));
  const W = weeks * 5 - 1,
    H = 18;
  const total = data.reduce<number>((a, n) => a + (n ?? 0), 0);
  return (
    <svg
      className="spark"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${total} commits in the last ${weeks} weeks`}
    >
      <title>{`Commits per week, last ${weeks} weeks (oldest first): ${data.map((n) => (n === null ? "?" : n)).join(", ")}`}</title>
      {data.map((n, i) => {
        const x = i * 5;
        if (n === null) return <rect key={i} x={x + 1} y={H - 2} width={2} height={2} className="spark-unknown" />;
        const h = n > 0 ? Math.max(2, Math.round((n / max) * H)) : 1;
        return <rect key={i} x={x} y={H - h} width={4} height={h} className={n === 0 ? "spark-zero" : i === data.length - 1 ? "spark-now" : "spark-bar"} />;
      })}
    </svg>
  );
}
