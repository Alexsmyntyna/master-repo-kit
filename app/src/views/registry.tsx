// Views that wiki pages can embed with a fenced block:
//
//   ```view
//   git-momentum
//   ```
//
// To add a visualization: write a component in this folder, register it here, and use it from a
// wiki page in companies/<slug>/wiki/. Lines after the name ("key: value") arrive as options.
import { GitHotspots } from "./git-hotspots";
import { GitMomentum } from "./git-momentum";
import { GitSegments } from "./git-segments";
import { PhotoAdjacentBands } from "./photo-adjacent-bands";
import { PhotoCullFunnel } from "./photo-cull-funnel";
import { PhotoExtraHour } from "./photo-extra-hour";
import { PhotoMarketBand } from "./photo-market-band";
import { PhotoPricePerHour } from "./photo-price-per-hour";
import { PhotoTimeCostData } from "./photo-time-cost-data";
import { PipelineView } from "./pipeline";
import { SharedRollEconomics } from "./shared-roll-economics";

export type ViewProps = { slug: string; options: Record<string, string> };

export const views: Record<
  string,
  { title: string; render: (props: ViewProps) => React.ReactNode }
> = {
  "git-momentum": { title: "Commits per month", render: (p) => <GitMomentum {...p} /> },
  "git-hotspots": { title: "Rework hotspots", render: (p) => <GitHotspots {...p} /> },
  "git-segments": { title: "Git stretches", render: (p) => <GitSegments {...p} /> },
  pipeline: { title: "Data pipeline", render: (p) => <PipelineView {...p} /> },
  "photo-time-cost": { title: "Time and price model", render: (p) => <PhotoTimeCostData {...p} /> },
  "photo-market-band": { title: "Local wedding starting prices", render: (p) => <PhotoMarketBand {...p} /> },
  "photo-extra-hour": { title: "Extra-hour rates", render: (p) => <PhotoExtraHour {...p} /> },
  "photo-cull-funnel": { title: "Cull funnel", render: (p) => <PhotoCullFunnel {...p} /> },
  "photo-price-per-hour": { title: "Price per hour by genre", render: (p) => <PhotoPricePerHour {...p} /> },
  "photo-adjacent-bands": { title: "Travel, events, commercial, headshots, Venice", render: (p) => <PhotoAdjacentBands {...p} /> },
  "shared-roll-economics": { title: "Shared-roll cost model", render: () => <SharedRollEconomics /> },
};
