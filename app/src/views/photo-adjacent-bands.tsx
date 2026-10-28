import type { ViewProps } from "./registry";
import { getPricingCharts, perHour, usd, type Band } from "@/lib/pricing-charts";
import { Caption, DataTable, Empty, W, scale } from "./photo-pricing-shared";

type Row = { label: string; lo: number; hi: number | null; kind: "market" | "owner" | "ref" | "pts"; tip: string; pts?: { v: number; t: string }[]; open?: boolean };
type Panel = { id: string; title: string; unit: string; cur: string; max: number; ticks: number[]; rows: Row[]; source: string; date: string; note?: string };

const money = (cur: string, v: number) => (cur === "EUR" ? "€" : "$") + Math.round(v).toLocaleString("en-US");
const unitLabel = (b: Band) => {
  const u = (b.unit || "").replace(/^USD\s*/, "").trim();
  return u ? `${b.name} (${u})` : b.name;
};
const fromBand = (b: Band, kind: Row["kind"] = "market", cur = "USD"): Row => ({
  label: b.name,
  lo: b.low,
  hi: b.high,
  kind,
  open: b.openEnded,
  tip: `${b.name}: ${money(cur, b.low)}${b.high ? " to " + money(cur, b.high) : ""}${b.openEnded ? "+" : ""}${b.unit ? " " + b.unit : ""} (${b.type || "source"}, ${b.date})`,
});

// Horizontal range bars for the adjacent work: travel, events, commercial, headshots, Venice (EUR).
export async function PhotoAdjacentBands({ slug }: ViewProps) {
  const data = await getPricingCharts(slug);
  if (!data) return <Empty />;
  const s = data.series;
  const events = s.ownerPackages.items.filter((p) => p.genre === "Event").map(perHour);
  const hs = s.headshots.owner;
  const panels: Panel[] = [
    {
      id: "travel",
      title: "Travel line items",
      unit: "USD, unit in each label",
      cur: "USD",
      max: 650,
      ticks: [0, 200, 400, 600],
      rows: s.travel.items.map((b) => ({ ...fromBand(b, b.type === "cost basis" ? "ref" : "market"), label: unitLabel(b) })),
      source: "Tov Studio guide (2026-04-19), Fedweek (2026-09-08), Monica Salazar page",
      date: "2026-10-14",
      note: "Guide figures, not rate cards. Mileage ($0.66 per mile, Sarah Haines, 2024-03-04) and Knot's $1,000 to $5,000+ total are in the table.",
    },
    {
      id: "events",
      title: "Event photos",
      unit: "USD per hour",
      cur: "USD",
      max: 650,
      ticks: [0, 200, 400, 600],
      rows: [
        ...s.corporateEvents.items.map((b) => fromBand(b)),
        { label: "You, event packages (price / hours)", lo: Math.min(...events), hi: Math.max(...events), kind: "owner", tip: `Your three event packages: ${usd(Math.min(...events))} to ${usd(Math.max(...events))} per hour of coverage` },
      ],
      source: "Lars Miller Media (2026-03-20), eventplanning.com, Erica Camille (2026-10-03); You, from the live events page",
      date: "2026-10-14",
    },
    {
      id: "commercial",
      title: "Commercial day rate",
      unit: "USD per day, usage extra",
      cur: "USD",
      max: 10500,
      ticks: [0, 2500, 5000, 7500, 10000],
      rows: s.commercial.items.map((b) => fromBand(b)),
      source: "dcadavid.com (2026-03), imagestudio.com (2026-07-04), imagen-ai.com (search summary)",
      date: "2026-10-14",
      note: "You have no commercial day rate published.",
    },
    {
      id: "headshots",
      title: "Headshots, Sarasota",
      unit: "USD per session or person",
      cur: "USD",
      max: 1500,
      ticks: [0, 500, 1000, 1500],
      rows: [
        ...s.headshots.items.map((b) => fromBand(b)),
        { label: "You, headshot packages (code only)", lo: hs.low, hi: hs.high, kind: "owner", tip: `You: ${usd(hs.low)} to ${usd(hs.high)} per package; ${hs.note}` },
      ],
      source: "srqheadshots.com, ristainophotography.com, jamesconnell.com; You, from services-cost.ts at 122d852 (2026-09-26)",
      date: "2026-10-14",
    },
    {
      id: "venice",
      title: "Venice and Italy destination",
      unit: "EUR, no conversion",
      cur: "EUR",
      max: 13000,
      ticks: [0, 4000, 8000, 12000],
      rows: [
        ...s.venice.bands.map((b) => fromBand(b, "market", "EUR")),
        {
          label: "Venice photographer by coverage hours",
          lo: s.venice.hourly.points[0].price,
          hi: s.venice.hourly.points.at(-1)!.price,
          kind: "pts",
          pts: s.venice.hourly.points.map((p) => ({ v: p.price, t: `${p.hours} h` })),
          tip: `Camilla M, Venice: ${s.venice.hourly.points.map((p) => `${p.hours} h ${money("EUR", p.price)}`).join(", ")}; planning included`,
        },
      ],
      source: "camillam.it (2026-06-01), emilianorusso.com, fearlessphotographers.com (2025)",
      date: "2026-10-14",
      note: "Italian studios bundle travel inside Italy. No Venice, Florida figures were searched. No dollar rate for a US photographer in Italy was found.",
    },
  ];
  return (
    <figure className="vfig pp">
      {panels.map((p) => {
        const x0 = 10,
          x1 = 330;
        const x = scale(0, p.max, x0, x1);
        const rowH = 40;
        const H = p.rows.length * rowH + 28;
        return (
          <div className="vblock" key={p.id} id={`adjacent-${p.id}`}>
            <div className="vhead">
              <strong>{p.title}</strong>
              <span className="vfacts">
                <span>{p.unit}</span>
              </span>
            </div>
            <svg className="vchart pp" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.title}, ${p.unit}: ${p.rows.map((r) => `${r.label} ${money(p.cur, r.lo)}${r.hi ? " to " + money(p.cur, r.hi) : ""}`).join("; ")}`}>
              {p.ticks.map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={0} y2={H - 24} className={t ? "vgrid" : "vbase"} />
                  <text x={x(t)} y={H - 8} textAnchor="middle" className="vtick">
                    {(p.cur === "EUR" ? "€" : "$") + (t >= 1000 ? t / 1000 + "k" : t)}
                  </text>
                </g>
              ))}
              {p.rows.map((r, i) => {
                const top = 4 + i * rowH;
                const cy = top + 27;
                const cls = ["owner"].includes(r.kind) ? "pp-owner" : r.kind === "ref" ? "pp-ref-fill" : "pp-local";
                return (
                  <g key={r.label}>
                    <title>{r.tip}</title>
                    <text x={x0} y={top + 12} className="vlabel">
                      {r.label}
                    </text>
                    {r.kind === "pts" ? (
                      <>
                        {r.pts!.map((pt) => (
                          <g key={pt.t}>
                            <circle cx={x(pt.v)} cy={cy} r={5} className="pp-local" />
                            <text x={x(pt.v)} y={cy + 17} textAnchor="middle" className="vtick">
                              {pt.t}
                            </text>
                          </g>
                        ))}
                        <text x={x(r.hi!) + 12} y={cy + 4} className="vvalue">
                          {money(p.cur, r.lo)} to {money(p.cur, r.hi!)}
                        </text>
                      </>
                    ) : r.hi ? (
                      <>
                        <rect x={x(r.lo)} y={cy - 5} width={x(r.hi) - x(r.lo)} height={10} rx={5} className={cls} />
                        <text x={x(r.hi) + 8} y={cy + 4} className="vvalue">
                          {money(p.cur, r.lo)} to {money(p.cur, r.hi)}
                          {r.open ? "+" : ""}
                        </text>
                      </>
                    ) : (
                      <>
                        <circle cx={x(r.lo)} cy={cy} r={5} className={cls} />
                        <text x={x(r.lo) + 12} y={cy + 4} className="vvalue">
                          {money(p.cur, r.lo)}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
            <Caption source={p.source} date={p.date}>
              {p.note}
            </Caption>
            <DataTable
              head={["Item", "Low", "High", "Kind", "Date"]}
              rows={p.rows.map((r) => [r.label, money(p.cur, r.lo), r.hi ? money(p.cur, r.hi) : "-", ["owner"].includes(r.kind) ? "You" : r.kind === "ref" ? "cost basis" : "public source", p.date])}
            />
          </div>
        );
      })}
    </figure>
  );
}
