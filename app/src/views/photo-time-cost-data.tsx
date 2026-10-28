import type { ViewProps } from "./registry";
import { readContent } from "@/lib/files";
import { repoRoot } from "@/lib/repository";
import { PhotoTimeCost, type PricingModel } from "./photo-time-cost";

// Reads companies/<slug>/pricing-model.json on the server and hands it to the client model.
export async function PhotoTimeCostData({ slug }: ViewProps) {
  let model: PricingModel;
  try {
    model = JSON.parse(await readContent(repoRoot, `companies/${slug}/pricing-model.json`));
  } catch {
    return <p className="view-empty">No pricing model yet</p>;
  }
  for (const input of Object.values(model.presets).flatMap((preset) => preset.inputs)) if (input.source === "alex") input.source = "owner";
  return <PhotoTimeCost model={model} />;
}
