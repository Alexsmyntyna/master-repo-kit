import { readContent } from "./files";
import { repoRoot } from "./repository";

// Reads companies/<slug>/pricing-charts.json: the series behind the photo-* price views.
export type Meta = { source: string; ref: string; date: string };
export type Point = { hours: number | null; price: number; priceHigh: number | null; label: string | null };
export type Competitor = Meta & {
  name: string;
  area: string;
  points: Point[];
  secondShooter: string | null;
  extraHour: number | null;
  url: string;
  snippetOnly: boolean;
  note: string | null;
  plot: boolean;
};
export type Pkg = {
  genre: string;
  name: string;
  price: number;
  hours: number;
  images: string;
  retouched: number | null;
  upTo: boolean;
  where: string;
  note: string | null;
};
export type Survey = Meta & { name: string; average: number; year: string; region: string; caveat: string };
export type Band = { name: string; low: number; high: number | null; ref: string; date: string; type?: string; unit?: string; openEnded?: boolean; average?: number };
export type Stage = { label: string; value: number; source: string; quote?: string; note?: string; ref?: string };

export type PricingCharts = {
  series: {
    competitors: Meta & { items: Competitor[] };
    ownerPackages: Meta & { note: string; items: Pkg[] };
    surveys: { items: Survey[] };
    extraHour: Meta & {
      owner: Meta & { rate: number; basis: string; quote: string; note: string };
      local: { name: string; rate: number; ref: string }[];
      guides: { name: string; low: number; high: number; ref: string; date: string }[];
    };
    cull: Meta & { genres: { id: string; label: string; stages: Stage[] }[] };
    travel: Meta & { items: Band[]; structures: { name: string; detail: string; ref: string; date: string }[] };
    venice: Meta & {
      hourly: { name: string; points: { hours: number; price: number }[]; ref: string; date: string };
      bands: Band[];
    };
    corporateEvents: Meta & { items: Band[] };
    commercial: Meta & { items: Band[] };
    headshots: Meta & { items: Band[]; owner: Meta & { low: number; high: number; note: string } };
  };
};

export async function getPricingCharts(slug: string): Promise<PricingCharts | null> {
  try {
    const data = JSON.parse(await readContent(repoRoot, `companies/${slug}/pricing-charts.json`));
    data.series.ownerPackages = data.series.ownerPackages ?? data.series.alexPackages;
    data.series.extraHour.owner = data.series.extraHour.owner ?? data.series.extraHour.alex;
    data.series.headshots.owner = data.series.headshots.owner ?? data.series.headshots.alex;
    for (const genre of data.series.cull.genres)
      for (const stage of genre.stages) if (stage.source === "alex") stage.source = "owner";
    return data;
  } catch {
    return null;
  }
}

export const perHour = (p: Pkg) => p.price / p.hours;
export const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
