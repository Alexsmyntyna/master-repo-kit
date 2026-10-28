import type { ViewProps } from "./registry";
import { getPricingCharts, perHour, usd } from "@/lib/pricing-charts";
import { Caption, DataTable, Empty, Legend, W, scale } from "./photo-pricing-shared";

// Each genre's packages as price per hour of coverage: one bar spans the genre, one dot per package.
export async function PhotoPricePerHour({ slug }: ViewProps) {
  const data = await getPricingCharts(slug);
  if (!data) return <Empty />;
  const { ownerPackages } = data.series;
  const genres = [...new Set(ownerPackages.items.map((p) => p.genre))].map((g) => {
    const items = ownerPackages.items.filter((p) => p.genre === g);
    const rates = items.map(perHour);
    return { g, items, lo: Math.min(...rates), hi: Math.max(...rates) };
  });
  genres.sort((a, b) => b.hi - a.hi);
  const x0 = 10,
    x1 = 320;
  const x = scale(0, 650, x0, x1);
  const rowH = 44;
  const H = genres.length * rowH + 30;
  return (
    <figure className="vfig pp">
      <div className="vblock">
        <Legend items={[["pp-sw-owner", "Package, fixed hours"], ["pp-sw-hollow", "Package, up to N hours"]]} />
        <svg className="vchart pp" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price per hour of coverage by genre: ${genres.map((r) => `${r.g} ${usd(r.lo)} to ${usd(r.hi)}`).join(", ")}`}>
          {[0, 200, 400, 600].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={H - 24} className={t ? "vgrid" : "vbase"} />
              <text x={x(t)} y={H - 8} textAnchor="middle" className="vtick">
                {t ? "$" + t : "$0"}
              </text>
            </g>
          ))}
          {genres.map((r, i) => {
            const top = 4 + i * rowH;
            const cy = top + 28;
            return (
              <g key={r.g}>
                <text x={x0} y={top + 12} className="vlabel">
                  {r.g}
                </text>
                <rect x={x(r.lo) - 4} y={cy - 4} width={x(r.hi) - x(r.lo) + 8} height={8} rx={4} className="pp-band" />
                {r.items.map((p) => (
                  <g key={p.name}>
                    <title>{`${r.g} ${p.name}: ${usd(p.price)} for ${p.upTo ? "up to " : ""}${p.hours} h = ${usd(perHour(p))} per hour${p.note ? ". " + p.note : ""}`}</title>
                    <circle cx={x(perHour(p))} cy={cy} r={5} className={p.upTo ? "pp-hollow" : "pp-owner"} />
                  </g>
                ))}
                <text x={x(r.hi) + 12} y={cy + 4} className="vvalue">
                  {r.lo === r.hi ? usd(r.hi) : `${usd(r.lo)} to ${usd(r.hi)}`}
                </text>
              </g>
            );
          })}
        </svg>
        <Caption source="weddings, portraits, engagements, family, events, real estate pages (live) and services-cost.ts at 122d852 (2026-09-26)" date="2026-10-14">
          Price divided by stated coverage hours, not paid hours; &ldquo;up to&rdquo; packages use the maximum, so they are the lowest rate they can reach. Proposal Coverage counts 45 minutes. Architecture, couples, studio, headshot and talent packages are in code only.
        </Caption>
        <DataTable
          head={["Genre", "Package", "Price", "Hours", "Per hour"]}
          rows={ownerPackages.items.map((p) => [p.genre, p.name, usd(p.price), (p.upTo ? "up to " : "") + p.hours, usd(perHour(p))])}
        />
      </div>
    </figure>
  );
}
