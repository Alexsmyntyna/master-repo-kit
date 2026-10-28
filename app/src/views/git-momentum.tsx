import { FourWeekRun } from "@/components/activity";
import { Source } from "@/components/ds";
import { getActivity, reposOf } from "@/lib/activity";
import { dateLabel } from "@/lib/model";
import { getCompany } from "@/lib/repository";
import { getSnapshot } from "@/lib/wiki";
import type { ViewProps } from "./registry";
import "@/styles/views.css";

type Month = { month: string; commits: number; fixes: number };

// Every month from the first to the last, quiet ones included as zero.
function filled(months: Month[]): Month[] {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  if (!sorted.length) return [];
  const by = new Map(sorted.map((m) => [m.month, m]));
  const out: Month[] = [];
  let [y, m] = sorted[0].month.split("-").map(Number);
  const last = sorted.at(-1)!.month;
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(by.get(key) || { month: key, commits: 0, fixes: 0 });
    if (key >= last) break;
    m++;
    if (m > 12) (m = 1), y++;
  }
  return out;
}

const niceMax = (n: number) => {
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(1, n))));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * step >= n) return k * step;
  return 10 * step;
};
const monthName = (key: string) =>
  new Date(key + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

// Commits per month as columns: fix-style commits in red at the base, the rest in the accent.
export function MonthColumns({ months }: { months: Month[] }) {
  const data = filled(months);
  const max = niceMax(Math.max(1, ...data.map((d) => d.commits)));
  const W = 1000,
    H = 210,
    left = 36,
    bottom = 24,
    top = 14;
  const plotW = W - left,
    plotH = H - bottom - top;
  const slot = plotW / data.length;
  const bar = Math.min(40, slot * 0.6);
  const y = (n: number) => top + plotH - (n / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const labelEvery = Math.ceil(data.length / 14);
  return (
    <svg
      className="vchart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Commits per month: ${data.map((d) => `${monthName(d.month)} ${d.month.slice(0, 4)} ${d.commits}`).join(", ")}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W} y1={y(t)} y2={y(t)} className={t ? "vgrid" : "vbase"} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" className="vtick">
            {t}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = left + i * slot + (slot - bar) / 2;
        const showLabel = i % labelEvery === 0;
        const year = i === 0 || d.month.endsWith("-01");
        return (
          <g key={d.month}>
            <title>{`${monthName(d.month)} ${d.month.slice(0, 4)}: ${d.commits} commits, ${d.fixes} fix-style`}</title>
            {d.commits > d.fixes && (
              <rect x={x} y={y(d.commits)} width={bar} height={y(d.fixes) - y(d.commits)} rx={2} className="vbar" />
            )}
            {d.fixes > 0 && <rect x={x} y={y(d.fixes)} width={bar} height={y(0) - y(d.fixes)} rx={2} className="vbar-risk" />}
            {d.commits > 0 && data.length <= 18 && (
              <text x={x + bar / 2} y={y(d.commits) - 5} textAnchor="middle" className="vvalue">
                {d.commits}
              </text>
            )}
            {showLabel && (
              <text x={x + bar / 2} y={H - 6} textAnchor="middle" className="vtick">
                {monthName(d.month)}
                {year ? ` ${d.month.slice(2, 4)}` : ""}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <span className="vlegend">
      {items.map(([cls, text]) => (
        <span key={text}>
          <i className={cls} />
          {text}
        </span>
      ))}
    </span>
  );
}

// Commits per month across the repo's life, and the last four weeks as the overview shows them.
export async function GitMomentum({ slug }: ViewProps) {
  const snap = await getSnapshot(slug);
  const repos = snap?.repos.filter((r) => r.months?.length) || [];
  if (!repos.length)
    return (
      <p className="view-empty">
        No git snapshot yet. Run <code>python3 tools/git_history.py snapshot {slug}</code>.
      </p>
    );
  const activity = await getActivity(reposOf((await getCompany(slug))?.repos));
  return (
    <figure className="vfig">
      {repos.map((r) => (
        <div key={r.label} className="vblock">
          <figcaption className="vhead">
            <strong>{repos.length > 1 ? r.label : "Commits per month"}</strong>
            <span className="vfacts">
              <span>
                <span className="vnum">{r.commits}</span> commits
              </span>
              <span>
                <span className="vnum">{Math.round(((r.fixes || 0) * 100) / Math.max(1, r.commits))}%</span> fix-style
              </span>
              <span>
                {dateLabel(r.first)} – {dateLabel(r.last)}
              </span>
            </span>
          </figcaption>
          <MonthColumns months={r.months!} />
          <div className="vfoot">
            <Legend items={[["sw-accent", "Commits"], ["sw-risk", "Fix-style"]]} />
            <Source who="code" date={snap!.generated} cite={`companies/${slug}/git/snapshot.json`} />
          </div>
        </div>
      ))}
      <div className="vblock vrun">
        <p className="vsub">Last four weeks</p>
        <FourWeekRun a={activity} />
      </div>
    </figure>
  );
}
