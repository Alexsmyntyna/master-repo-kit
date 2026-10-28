import type { ViewProps } from "./registry";
import { getPricingCharts, type Stage } from "@/lib/pricing-charts";
import { Caption, DataTable, Empty, Legend, W, scale } from "./photo-pricing-shared";

const cls = (s: Stage) => (["owner"].includes(s.source) ? "pp-owner" : s.source === "agent" ? "pp-agent" : "pp-public");
const n = (v: number) => v.toLocaleString("en-US");
const pct = (v: number, of: number) => {
  const p = (v / of) * 100;
  return p >= 10 ? Math.round(p) + "%" : p.toFixed(1).replace(/\.0$/, "") + "%";
};

// Frames shot, kept after the cull, and closely edited, for a wedding and a portrait session.
export async function PhotoCullFunnel({ slug }: ViewProps) {
  const data = await getPricingCharts(slug);
  if (!data) return <Empty />;
  const { cull } = data.series;
  return (
    <figure className="vfig pp">
      <Legend items={[["pp-sw-owner", "Your number"], ["pp-sw-public", "On your site"], ["pp-sw-agent", "Model example"]]} />
      {cull.genres.map((g) => {
        const max = g.stages[0].value;
        const x0 = 10,
          x1 = 300;
        const x = scale(0, max, x0, x1);
        const rowH = 44;
        const H = g.stages.length * rowH + 8;
        const quotes = g.stages.filter((s) => s.quote);
        return (
          <div className="vblock" key={g.id}>
            <div className="vhead">
              <strong>{g.label}</strong>
              <span className="vfacts">
                <span>Own scale, starting at {n(max)} frames</span>
              </span>
            </div>
            <svg className="vchart pp" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${g.label} cull: ${g.stages.map((s) => `${s.label} ${n(s.value)}`).join(", ")}`}>
              {g.stages.map((s, i) => {
                const top = 4 + i * rowH;
                return (
                  <g key={s.label}>
                    <title>{`${s.label}: ${n(s.value)}${s.quote ? `. "${s.quote}"` : ""}${s.note ? `. ${s.note}` : ""}`}</title>
                    <text x={x0} y={top + 13} className="vlabel">
                      {s.label}
                    </text>
                    <rect x={x0} y={top + 20} width={Math.max(3, x(s.value) - x0)} height={16} rx={3} className={cls(s)} />
                    <text x={Math.max(3, x(s.value)) + 8} y={top + 33} className="vvalue">
                      {n(s.value)}
                      {i > 0 ? ` · ${pct(s.value, max)} of frames` : ""}
                    </text>
                  </g>
                );
              })}
            </svg>
            {quotes.map((s) => (
              <p className="vcaveat pp-quote" key={s.label}>
                &ldquo;{s.quote}&rdquo; (You, {s.label.toLowerCase()})
              </p>
            ))}
            <DataTable head={["Stage", "Frames", "Source"]} rows={g.stages.map((s) => [s.label, n(s.value), s.note || (["owner"].includes(s.source) ? "You, dump" : s.source)])} />
          </div>
        );
      })}
      <Caption source="Pricing charts data: cull stages and published packages" date="2026-10-14">
        The model&apos;s example retouch count is 150, not a published figure. For portraits you said &ldquo;one to 3000&rdquo; frames; 2,000 is the model&apos;s value.
      </Caption>
    </figure>
  );
}
