import { TriangleAlert } from "lucide-react";
import { WINDOW, type Activity } from "@/lib/activity";
import { dateLabel } from "@/lib/model";

const WEEKS = ["4 wks ago", "3 wks ago", "2 wks ago", "This week"];
const level = (n: number, peak: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / peak) * 4)));

// The last four weeks as four blocks of seven days: each square is a day, shaded by how many commits it had
// (scaled to this project's busiest day), with the week's count under it. Past four weeks of quiet, the run is
// replaced by a warning: how long it has been and when it was last touched.
export function FourWeekRun({ a, compact = false }: { a: Activity; compact?: boolean }) {
  if (a.freshness === "none") return <div className="run run-none">No git history</div>;
  if (a.freshness === "stale" || a.freshness === "old") return <StaleRun a={a} />;
  const peak = Math.max(1, ...a.days);
  return (
    <div
      className="run"
      role="img"
      aria-label={`${a.total} commits over the last four weeks: ${a.weeks.join(", ")} per week, oldest first`}
    >
      {a.weeks.map((count, w) => (
        <div key={w} className={`run-week ${w === 3 ? "is-now" : ""} ${count ? "" : "is-quiet"}`}>
          <div className="run-days">
            {a.days.slice(w * 7, w * 7 + 7).map((n, d) => (
              <i key={d} className={`l${level(n, peak)}`} title={`${n} commit${n === 1 ? "" : "s"}`} />
            ))}
          </div>
          <span className="run-count mono">{count || "–"}</span>
          {!compact && <span className="run-label">{WEEKS[w]}</span>}
        </div>
      ))}
    </div>
  );
}

function StaleRun({ a }: { a: Activity }) {
  const old = a.freshness === "old";
  return (
    <div className={`run-stale ${old ? "is-old" : ""}`} role="img" aria-label={`No commits for ${a.idle} days`}>
      <TriangleAlert aria-hidden />
      <div>
        <strong>
          {a.idle} days quiet{old ? " · out of date" : ""}
        </strong>
        <span>last commit {dateLabel(a.last)}</span>
      </div>
      <span className="run-stale-meter" aria-hidden>
        {/* how far past the four-week window it is, out to a year */}
        <b style={{ width: `${Math.min(100, ((a.idle || 0) / 365) * 100)}%` }} />
        <i style={{ left: `${(WINDOW / 365) * 100}%` }} />
      </span>
    </div>
  );
}
