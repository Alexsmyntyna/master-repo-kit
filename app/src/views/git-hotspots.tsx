import { Source } from "@/components/ds";
import { dateLabel } from "@/lib/model";
import { getSnapshot } from "@/lib/wiki";
import { Legend } from "./git-momentum";
import type { ViewProps } from "./registry";
import "@/styles/views.css";

// Files most touched by fix-style commits, and files written once and rarely revisited.
export async function GitHotspots({ slug }: ViewProps) {
  const snap = await getSnapshot(slug);
  const repos = snap?.repos.filter((r) => r.hotspots?.length || r.written_once?.length) || [];
  if (!repos.length) return <p className="view-empty">No hotspots</p>;
  return (
    <div className="vfig">
      {repos.map((r) => {
        const max = Math.max(1, ...(r.hotspots || []).map((h) => h.touches));
        return (
          <div className="vblock" key={r.label}>
            {!!r.hotspots?.length && (
              <>
                <div className="vhead">
                  <strong>{repos.length > 1 ? `Rework hotspots · ${r.label}` : "Rework hotspots"}</strong>
                  <span className="vfacts">
                    <span>
                      <span className="vnum">{r.hotspots.length}</span> files
                    </span>
                  </span>
                </div>
                <div className="vhot">
                  {r.hotspots.map((h) => {
                    const cut = h.path.lastIndexOf("/");
                    return (
                      <div className="vhot-row" key={h.path} title={`${h.fixes} fix-style of ${h.touches} edits`}>
                        <span className="vhot-file">
                          <span>{h.path.slice(0, cut + 1)}</span>
                          {h.path.slice(cut + 1)}
                        </span>
                        <span className="vhot-bar" aria-hidden>
                          <i style={{ width: `${(h.touches / max) * 100}%` }} />
                          <b style={{ width: `${(h.fixes / max) * 100}%` }} />
                        </span>
                        <span className="vhot-num">
                          <span className="vnum is-risk">{h.fixes}</span>
                          <span className="faint"> / </span>
                          <span className="vnum">{h.touches}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="vfoot">
                  <Legend items={[["sw-risk", "Fix-style commits"], ["sw-accent-soft", "All edits"]]} />
                  <Source who="code" date={snap!.generated} cite={`companies/${slug}/git/snapshot.json`} />
                </div>
              </>
            )}
            {!!r.written_once?.length && (
              <div className="vonce">
                <p className="vsub">Rarely touched</p>
                <div className="rows rows-dense">
                  {r.written_once.map((w) => (
                    <div className="row" key={w.path}>
                      <span className="row-body">
                        <span className="row-title code-text" title={w.path}>
                          {w.path.split("/").pop()}
                        </span>
                      </span>
                      <span className="row-trail">
                        {dateLabel(w.date)}
                        {w.present ? "" : " · since removed"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
