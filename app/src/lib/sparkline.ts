// Commits per week for the Sparkline (components/sparkline.tsx), read from a project's git/snapshot.json.
// The snapshot keeps work stretches (segments: from, to, commits), not single commits, so each stretch's commits are
// spread evenly over its days and summed into seven-day weeks ending today. Weeks after the snapshot was generated
// haven't been read and come back null, so they show as unknown rather than quiet. Client-safe: no file access.

export type WeekSegment = { from: string; to: string; commits: number };
export type WeekRepo = { segments?: WeekSegment[] };
export type WeekSnapshot = { generated?: string; repos: WeekRepo[] };

const DAY = 86400000;
const dayOf = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) : NaN);
const isoDay = (t: Date) => Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());

// `weeks` buckets, oldest first; the last one is the seven days ending `today`. Null: not read yet. Empty array: no
// snapshot or no stretches at all.
export function weeklyCommits(snapshot: WeekSnapshot | null | undefined, weeks = 12, today: Date | string = new Date()): (number | null)[] {
  const segs = (snapshot?.repos || []).flatMap((r) => r.segments || []).filter((s) => s.commits > 0 && !Number.isNaN(dayOf(s.from)));
  if (!segs.length) return [];
  const end = typeof today === "string" ? dayOf(today) : isoDay(today);
  const start = end - (weeks * 7 - 1) * DAY;
  const read = snapshot?.generated ? dayOf(snapshot.generated) : NaN;
  const out = new Array<number>(weeks).fill(0);
  for (const s of segs) {
    const from = dayOf(s.from);
    const to = Number.isNaN(dayOf(s.to)) ? from : Math.max(from, dayOf(s.to));
    const days = Math.round((to - from) / DAY) + 1;
    const per = s.commits / days;
    for (let t = Math.max(from, start); t <= Math.min(to, end); t += DAY) out[Math.floor((t - start) / DAY / 7)] += per;
  }
  return out.map((n, i) => {
    const weekStart = start + i * 7 * DAY;
    if (!Number.isNaN(read) && weekStart > read) return null;
    return Math.round(n);
  });
}
