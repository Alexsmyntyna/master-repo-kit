import "@/styles/views.css";

// Pieces shared by the photo-* price views: a source caption, a table behind each chart, an
// empty state and a linear scale. Charts draw in a 440-wide box so text stays readable on a phone.
export const W = 440;

export function scale(d0: number, d1: number, p0: number, p1: number) {
  return (v: number) => p0 + ((v - d0) / (d1 - d0)) * (p1 - p0);
}

export function Caption({ source, date, children }: { source: string; date: string; children?: React.ReactNode }) {
  return (
    <p className="vcaveat pp-src">
      Source: {source}, {date}.{children ? <> {children}</> : null}
    </p>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number | null)[][] }) {
  return (
    <details className="pp-table">
      <summary>Table</summary>
      <div className="pp-table-scroll">
        <table className="ptc-table">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c === null ? "not published" : c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Empty() {
  return <p className="view-empty">No pricing chart data yet</p>;
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
