// Things made (documents, mockups, builds, threads) age: one dated over 30 days before the newest of its kind is
// marked older on the timeline, so what's been superseded shows.
export const OLDER_DAYS = 30;
export function markOlder<T extends { kind: string; date: string; older?: boolean }>(events: T[], aging: readonly string[]): T[] {
  const newest = new Map<string, string>();
  for (const e of events)
    if (aging.includes(e.kind) && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date > (newest.get(e.kind) || "")) newest.set(e.kind, e.date);
  return events.map((e) => {
    const top = newest.get(e.kind);
    if (!top || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return e;
    const days = (Date.parse(top) - Date.parse(e.date)) / 86400000;
    return days > OLDER_DAYS ? { ...e, older: true } : e;
  });
}
