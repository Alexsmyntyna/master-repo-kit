import { Source, State } from "@/components/ds";
import { dateLabel } from "@/lib/model";
import { getSnapshot } from "@/lib/wiki";
import { Legend } from "./git-momentum";
import type { ViewProps } from "./registry";
import "@/styles/views.css";

const day = (d: string) => Date.parse(d + "T12:00:00Z");
const short = (d: string) => dateLabel(d).replace(/, \d{4}$/, "");

// Stretches of work from the git ledger: when they ran, how much was fixing, and whether an agent has read
// them into the story yet.
export async function GitSegments({ slug }: ViewProps) {
  const snap = await getSnapshot(slug);
  const repos = snap?.repos.filter((r) => r.segments?.length) || [];
  if (!repos.length) return <p className="view-empty">No git stretches yet</p>;
  return (
    <div className="vfig">
      {repos.map((r) => {
        const segs = r.segments!;
        const start = day(segs[0].from),
          end = Math.max(start + 86400000, ...segs.map((s) => day(s.to)));
        const pos = (d: string) => ((day(d) - start) / (end - start)) * 100;
        const peak = Math.max(1, ...segs.map((s) => s.commits));
        const read = r.read || 0;
        return (
          <div key={r.label} className="vblock">
            <div className="vhead">
              <strong>{repos.length > 1 ? `Stretches of work · ${r.label}` : "Stretches of work"}</strong>
              <span className="vfacts">
                <span>
                  <span className="vnum">{segs.length}</span> stretches
                </span>
                <span>
                  <span className="vnum">{read}</span> of <span className="vnum">{r.commits}</span> commits read
                </span>
              </span>
            </div>
            {/* the life of the repo as one line, each stretch placed where it ran */}
            <div className="vstrip" aria-hidden>
              {segs.map((s) => (
                <i
                  key={s.id}
                  className={s.status === "read" ? "is-read" : ""}
                  style={{
                    left: `${pos(s.from)}%`,
                    width: `max(3px, ${pos(s.to) - pos(s.from)}%)`,
                    opacity: 0.45 + 0.55 * (s.commits / peak),
                  }}
                  title={`${short(s.from)} – ${short(s.to)}: ${s.commits} commits`}
                />
              ))}
            </div>
            <div className="vstrip-axis">
              <span>{dateLabel(segs[0].from)}</span>
              <span>{dateLabel(segs.at(-1)!.to)}</span>
            </div>
            <div className="vsegs">
              {segs.map((s) => {
                const fix = Math.round((s.fixes * 100) / Math.max(1, s.commits));
                return (
                  <details key={s.id} className="vseg">
                    <summary>
                      <span className="vseg-date">
                        {short(s.from)} – {short(s.to)}
                      </span>
                      <span className="vseg-bar" aria-hidden>
                        <i style={{ width: `${(s.commits / peak) * 100}%` }}>
                          <b style={{ width: `${fix}%` }} />
                        </i>
                      </span>
                      <span className="vseg-num">
                        <span className="vnum">{s.commits}</span> commits
                      </span>
                      <span className="vseg-num">
                        <span className="vnum">{fix}%</span> fixes
                      </span>
                      <State tone={s.status === "read" ? "ok" : "idle"}>{s.status === "read" ? "read" : "not read"}</State>
                      <span className="sha">{s.id}</span>
                    </summary>
                    {s.features.length > 0 ? (
                      <ul className="vseg-list">
                        {s.features.map((f) => (
                          <li key={f.sha}>
                            <span className="sha">{f.sha}</span>
                            <span>{f.subject}</span>
                            <span className="vseg-when">{short(f.date)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="vseg-none">No feature commits</p>
                    )}
                  </details>
                );
              })}
            </div>
            <div className="vfoot">
              <Legend items={[["sw-accent", "Commits"], ["sw-risk", "Fix-style share"]]} />
              <Source who="code" date={snap!.generated} cite={`companies/${slug}/git/ledger.json`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
