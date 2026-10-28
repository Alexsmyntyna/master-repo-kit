import { MockupLightbox } from "@/components/mockup-lightbox";
import { getMockupFrame } from "@/lib/mockup-reviews";
import { type Mockup } from "@/lib/mockups";
import "@/styles/mockups.css";

// Agents' mockups side by side, scaled down. A click opens them in a lightbox; the thumbnail stays a link to the
// review page (a review's mockup) or the full-size file, for a middle-click or Cmd-click.
export async function MockupStrip({ mockups }: { mockups: Mockup[] }) {
  if (!mockups.length) return null;
  const frames = await Promise.all(mockups.map((m) => getMockupFrame(m.path)));
  return <MockupLightbox items={mockups.map((m, i) => ({ ...m, ...frames[i] }))} />;
}
