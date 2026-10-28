// When a run that hit the usage limit goes again (tools/converse.py retry), in local time without seconds:
// "3:31 PM". Client-safe; used by the thread, the dock and the Board.
export function retryClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "later" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
