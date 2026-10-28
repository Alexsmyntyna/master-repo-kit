import type { ViewProps } from "./registry";
import { getPricingCharts, usd } from "@/lib/pricing-charts";
import { Caption, DataTable, Empty, Legend, W, scale } from "./photo-pricing-shared";

type Mark = { kind: "owner" | "local"; lo: number; hi: number | null; name: string; tip: string; w: number };

// Local wedding starting prices by hours of coverage, the owner's Basic and Standard, and survey averages.
export async function PhotoMarketBand({ slug }: ViewProps) {
  const data = await getPricingCharts(slug);
  if (!data) return <Empty />;
  const { competitors, ownerPackages, surveys } = data.series;
  const owner = ownerPackages.items.filter((p) => p.genre === "Wedding" && (p.name === "Basic" || p.name === "Standard"));
  const lanes = [4, 5, 6, 7, 8, 10];
  const marks: Mark[] = [];
  for (const p of owner) marks.push({ kind: "owner", lo: p.price, hi: null, name: p.name, tip: `You, ${p.name}: ${usd(p.price)}, ${p.hours} h`, w: p.hours });
  const unplotted: string[] = [];
  for (const c of competitors.items) {
    const pts = c.points.filter((p) => p.hours !== null);
    if (!c.plot || !pts.length) {
      unplotted.push(c.name);
      continue;
    }
    for (const p of pts)
      marks.push({
        kind: "local",
        lo: p.price,
        hi: p.priceHigh,
        name: c.name,
        tip: `${c.name}${c.snippetOnly ? " (search snippet)" : ""}: ${usd(p.price)}${p.priceHigh ? " to " + usd(p.priceHigh) : ""}, ${p.hours} h`,
        w: p.hours as number,
      });
  }
  const x0 = 46,
    x1 = W - 14,
    top = 34,
    sub = 17;
  const x = scale(1000, 6500, x0, x1);
  const ticks = [1000, 2000, 3000, 4000, 5000, 6000];
  // The owner sits alone in the first sub-row of their lane; competitors dodge from the second.
  const layout = lanes.map((h) => {
    const inLane = marks.filter((m) => m.w === h).sort((a, b) => a.lo - b.lo);
    const rows: { end: number }[] = [];
    const placed = inLane.map((m) => {
      if (["owner"].includes(m.kind)) return { m, row: 0 };
      let r = 1;
      while (rows[r] && rows[r].end > x(m.lo) - 15) r++;
      rows[r] = { end: x(m.hi ?? m.lo) };
      return { m, row: r };
    });
    const count = Math.max(1, ...placed.map((p) => p.row + 1), inLane.some((m) => ["owner"].includes(m.kind)) ? 1 : 0);
    return { h, placed, height: count * sub + 12 };
  });
  let y = top;
  const laneY = layout.map((l) => {
    const t = y;
    y += l.height;
    return t;
  });
  const H = y + 22;
  const knot = surveys.items.find((s) => s.name.startsWith("The Knot"))!;
  const zola = surveys.items.find((s) => s.name.startsWith("Zola"))!;
  return (
    <figure className="vfig pp">
      <div className="vblock">
        <Legend items={[["pp-sw-owner", "You"], ["pp-sw-local", "Local photographer"], ["pp-sw-ref", "Survey average, US"]]} />
        <svg
          className="vchart pp"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Local wedding starting prices by hours of coverage. You: Basic ${usd(owner[0].price)} for 4 hours, Standard ${usd(owner[1].price)} for 8 hours. Knot average ${usd(knot.average)}, Zola average ${usd(zola.average)}.`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 22} className="vgrid" />
              <text x={x(t)} y={H - 6} textAnchor="middle" className="vtick">
                ${t / 1000}k
              </text>
            </g>
          ))}
          {layout.map((l, i) => (
            <g key={l.h}>
              <line x1={x0 - 6} x2={x1} y1={laneY[i]} y2={laneY[i]} className="vbase" />
              <text x={0} y={laneY[i] + 16} className="vlabel">
                {l.h} h
              </text>
              {l.placed.map(({ m, row }, j) => {
                const cy = laneY[i] + 12 + row * sub;
                const cx = x(m.lo);
                return (
                  <g key={j}>
                    <title>{m.tip}</title>
                    {m.hi && <rect x={cx - 5} y={cy - 4} width={x(m.hi) - cx + 10} height={8} rx={4} className="pp-local" />}
                    {["owner"].includes(m.kind) ? (
                      <>
                        <path d={`M${cx} ${cy - 7} L${cx + 7} ${cy} L${cx} ${cy + 7} L${cx - 7} ${cy} Z`} className="pp-owner" />
                        <text x={cx + 12} y={cy + 4} className="vvalue">
                          {m.name} {usd(m.lo)}
                        </text>
                      </>
                    ) : (
                      !m.hi && <circle cx={cx} cy={cy} r={5} className="pp-local" />
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          <line x1={x0 - 6} x2={x1} y1={H - 22} y2={H - 22} className="vbase" />
          {[
            { s: knot, label: "Knot" },
            { s: zola, label: "Zola" },
          ].map(({ s, label }) => (
            <g key={label}>
              <title>{`${s.name}: average ${usd(s.average)} (${s.year}, ${s.region}). ${s.caveat}`}</title>
              <line x1={x(s.average)} x2={x(s.average)} y1={top - 18} y2={H - 22} className={label === "Knot" ? "pp-ref" : "pp-ref pp-ref-dash"} />
              <text x={x(s.average) + 4} y={top - 20} className="vvalue">
                {label} {usd(s.average)}
              </text>
            </g>
          ))}
        </svg>
        <Caption source="wedding-market note, pages fetched" date="2026-10-14">
          Starting package by hours of coverage; ranges are drawn as bars. Knot via getkepla.com (Knot page returned 403), couples married 2025; Zola updated 2026-02-19; both US, not Florida. Lucas Loman is a search snippet. Not plotted, no hour count: {unplotted.join(", ")}.
        </Caption>
        <DataTable
          head={["Photographer", "Hours", "Starting price", "Second shooter", "Extra hour"]}
          rows={competitors.items.flatMap((c) =>
            c.points.length
              ? c.points.map((p) => [
                  c.name,
                  p.hours ?? p.label,
                  usd(p.price) + (p.priceHigh ? " to " + usd(p.priceHigh) : ""),
                  c.secondShooter,
                  c.extraHour ? usd(c.extraHour) : null,
                ])
              : [[c.name, null, "enquire only", c.secondShooter, null]],
          )}
        />
      </div>
    </figure>
  );
}
