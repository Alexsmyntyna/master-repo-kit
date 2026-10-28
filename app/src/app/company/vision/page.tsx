import { getDocument } from "@/lib/repository";
import { dateLabel } from "@/lib/model";
import { Markdown } from "@/components/markdown";
import { VisionEditor } from "@/components/vision-editor";
import { Empty, PageHeader, Section, Source } from "@/components/ds";

export const metadata = { title: "Vision" };

// holding/vision.md: the parent company's vision, which the CEO reads before every turn. the owner edits it here.
export default async function CompanyVision() {
  const vision = await getDocument("holding/vision.md").catch(() => undefined);
  return (
    <div className="vision-page">
      <PageHeader
        title="Vision"
        meta={[
          vision?.meta.updated ? `updated ${dateLabel(vision.meta.updated)}` : "never written",
          vision && <Source key="s" who={String(vision.meta.written_by || "agent")} date={vision.meta.updated} cite="holding/vision.md" />,
        ]}
      />
      <Section title="Text" note={<span className="code-text">holding/vision.md</span>}>
        {vision ? (
          <VisionEditor body={vision.content}>
            <Markdown content={vision.content} path="holding/vision.md" />
          </VisionEditor>
        ) : (
          <Empty>No vision yet</Empty>
        )}
      </Section>
    </div>
  );
}
