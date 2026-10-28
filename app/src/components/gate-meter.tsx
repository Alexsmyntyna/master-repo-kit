import { gateCounts, type Gate } from "@/lib/cards";

// The finish-line gates as one segmented bar: done filled, open hollow, unknown dashed, then "done/total".
// Nothing when the card lists no gates.
export function GateMeter({ gates, label = true }: { gates: Pick<Gate, "state" | "name">[]; label?: boolean }) {
  if (!gates.length) return null;
  const c = gateCounts(gates);
  const order: Gate["state"][] = ["done", "open", "unknown"];
  const sorted = [...gates].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const words = [`${c.done} done`, c.open && `${c.open} open`, c.unknown && `${c.unknown} unknown`].filter(Boolean).join(", ");
  return (
    <span className="gate-meter" role="img" aria-label={`Finish gates: ${words}`} title={sorted.map((g) => `${g.state === "done" ? "✓" : g.state === "open" ? "○" : "?"} ${g.name}`).join("\n")}>
      <span className="gate-bar" aria-hidden>
        {sorted.map((g, i) => (
          <i key={i} className={`g-${g.state}`} />
        ))}
      </span>
      {label && (
        <span className="gate-count" aria-hidden>
          {c.done}/{c.total}
        </span>
      )}
    </span>
  );
}
