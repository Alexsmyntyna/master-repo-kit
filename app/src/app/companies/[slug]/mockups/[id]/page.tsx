import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Source, State } from "@/components/ds";
import { Markdown } from "@/components/markdown";
import { MockupReviewer } from "@/components/mockup-review";
import { getMockupReview } from "@/lib/mockup-reviews";
import { dateLabel } from "@/lib/model";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return { title: (await getMockupReview(slug, id))?.title || "Mockup" };
}

export default async function MockupReviewPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const review = await getMockupReview(slug, id);
  if (!review) notFound();
  const threadHref = review.thread ? `/threads/${review.thread.replace(/^companies\//, "").replace("/threads/", "/")}` : "";
  return (
    <MockupReviewer
      review={review}
      header={
        <PageHeader
          kicker={<Link href={`/companies/${slug}/mockups`}>Mockups</Link>}
          title={review.title}
          meta={[
            dateLabel(review.date),
            review.status === "archived" ? (
              <State tone="idle">Archived</State>
            ) : review.status === "answered" ? (
              <State tone="ok">Answered {review.answered && dateLabel(review.answered)}</State>
            ) : (
              <State tone="attention">Waiting on you</State>
            ),
            threadHref ? <Link href={threadHref}>Thread</Link> : null,
            <Source who="agent" cite={review.source || review.dir} />,
          ]}
        />
      }
      tradeoffs={
        review.tradeoffs ? <Markdown content={review.tradeoffs} path={`${review.dir}/review.md`} /> : <p className="mr-hint">None</p>
      }
    />
  );
}
