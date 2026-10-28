import type { Step, Stat } from "@/lib/brief";
import "@/styles/brief.css";

// The two diagrams agents draw in a message (```stats and ```flow); server and client views share them.
export function Stats({ items }: { items: Stat[] }) {
  return (
    <dl className="brief-stats">
      {items.map((s, i) => (
        <div key={i} className="brief-stat">
          <dd>{s.value}</dd>
          <dt>{s.label}</dt>
          {s.note && <dd className="brief-stat-note">{s.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// Numbered steps on one line (stacked on a narrow column); `now` is lit, `risk` is marked, `done` is ticked.
export function Flow({ steps }: { steps: Step[] }) {
  return (
    <ol className="brief-flow">
      {steps.map((s, i) => (
        <li key={i} className={`flow-step ${s.state ? `is-${s.state}` : ""}`}>
          <span className="flow-n">{s.state === "done" ? "✓" : i + 1}</span>
          <span className="flow-text">
            <strong>{s.label}</strong>
            {s.note && <small>{s.note}</small>}
          </span>
          {s.state && s.state !== "done" && <em>{s.state}</em>}
        </li>
      ))}
    </ol>
  );
}
