import type { ViewProps } from "./registry";
import { getPricingCharts, usd } from "@/lib/pricing-charts";
import { Caption, DataTable, Empty, Legend, W, scale } from "./photo-pricing-shared";

type Row = { group: string; label: string; lo: number; hi: number | null; cls: string; tip: string };

// Extra-hour rates: their $125 against published local rates and the guide bands.
export async function PhotoExtraHour({ slug }: ViewProps) {
  const data = await getPricingCharts(slug);
  if (!data) return <Empty />;
  const e = data.series.extraHour;
  const rows: Row[] = [
    { group: "You", label: "You, from $250 for two hours", lo: e.owner.rate, hi: null, cls: "pp-owner", tip: `${usd(e.owner.rate)} per hour (${e.owner.basis}); ${e.owner.note}` },
    ...[...e.local]
      .sort((a, b) => a.rate - b.rate)
      .map((l) => ({ group: "Published locally", label: l.name, lo: l.rate, hi: null, cls: "pp-local", tip: `${l.name}: ${usd(l.rate)} per hour` })),
    ...[...e.guides]
      .sort((a, b) => a.low - b.low)
      .map((g) => ({ group: "Guides, ranges", label: g.name, lo: g.low, hi: g.high, cls: "pp-guide", tip: `${g.name}: ${usd(g.low)} to ${usd(g.high)} per hour (${g.date})` })),
  ];
  const x0 = 10,
    x1 = 330;
  const x = scale(0, 800, x0, x1);
  const rowH = 38,
    head = 22;
  let y = 4;
  let last = "";
  const placed = rows.map((r) => {
    let gy: number | null = null;
    if (r.group !== last) {
      gy = y + 12;
      y += head;
      last = r.group;
    }
    const top = y;
    y += rowH;
    return { r, gy, top };
  });
  const H = y + 24;
  return (
    <figure className="vfig pp">
      <div className="vblock">
        <Legend items={[["pp-sw-owner", "You"], ["pp-sw-local", "Published locally"], ["pp-sw-guide", "Guide range"]]} />
        <svg className="vchart pp" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Extra-hour rates. You ${usd(e.owner.rate)}; published locally ${e.local.map((l) => `${l.name} ${usd(l.rate)}`).join(", ")}; guides ${e.guides.map((g) => `${usd(g.low)} to ${usd(g.high)}`).join(", ")}.`}>
          {[0, 200, 400, 600, 800].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={H - 22} className={t ? "vgrid" : "vbase"} />
              <text x={x(t)} y={H - 6} textAnchor="middle" className="vtick">
                {t ? "$" + t : "$0"}
              </text>
            </g>
          ))}
          {placed.map(({ r, gy, top }, i) => (
            <g key={i}>
              {gy !== null && (
                <text x={x0} y={gy} className="pp-group">
                  {r.group}
                </text>
              )}
              <title>{r.tip}</title>
              <text x={x0} y={top + 12} className="vlabel">
                {r.label}
              </text>
              {r.hi ? (
                <rect x={x(r.lo)} y={top + 19} width={x(r.hi) - x(r.lo)} height={12} rx={4} className={r.cls} />
              ) : (
                <rect x={x0} y={top + 18} width={x(r.lo) - x0} height={14} rx={2} className={r.cls} />
              )}
              <text x={x(r.hi ?? r.lo) + 8} y={top + 29} className="vvalue">
                {r.hi ? `${usd(r.lo)} to ${usd(r.hi)}` : usd(r.lo)}
              </text>
            </g>
          ))}
        </svg>
        <Caption source="your $125 is $250 for two extra hours (your spoken dump); local rates from wedding-market note; guides Tov Studio, Larson, timelesspv.com" date="2026-10-14">
          $125 is not on your site or in code. Nina Bashaw&apos;s $750 equals her $6,000 package divided by 8 hours.
        </Caption>
        <DataTable
          head={["Who", "Rate per hour", "Date"]}
          rows={[
            ["You", usd(e.owner.rate), e.owner.date],
            ...e.local.map((l) => [l.name, usd(l.rate), e.date]),
            ...e.guides.map((g) => [g.name, `${usd(g.low)} to ${usd(g.high)}`, g.date]),
          ]}
        />
      </div>
    </figure>
  );
}
