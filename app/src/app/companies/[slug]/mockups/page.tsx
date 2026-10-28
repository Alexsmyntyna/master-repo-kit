import { notFound } from "next/navigation";
import { Empty, PageHeader, Row, Rows, Section, State } from "@/components/ds";
import { getMockupReviews } from "@/lib/mockup-reviews";
import { getCompany } from "@/lib/repository";
import { dateLabel } from "@/lib/model";
import { mockupHref, noteCount, type MockupReview } from "@/lib/mockups";
import "@/styles/mockups.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c ? `${c.name} mockups` : "Mockups" };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function ProjectMockups({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();
  const reviews = await getMockupReviews(slug);
  const open = reviews.filter((r) => r.status === "open").length;
  const current = reviews.filter((r) => r.status !== "archived");
  const archived = reviews.filter((r) => r.status === "archived");
  return (
    <article>
      <PageHeader
        title="Mockups"
        meta={[plural(reviews.length, "review"), open ? <span className="warn">{open} waiting on you</span> : null]}
      />
      {current.length ? <ReviewRows slug={slug} reviews={current} /> : <Empty>No mockups yet</Empty>}
      {archived.length ? (
        <Section title="Archive" note={plural(archived.length, "review")}>
          <ReviewRows slug={slug} reviews={archived} />
        </Section>
      ) : null}
    </article>
  );
}

function ReviewRows({ slug, reviews }: { slug: string; reviews: MockupReview[] }) {
  return (
    <Rows>
      {reviews.map((r) => (
        <Row
          key={r.id}
          href={`/companies/${slug}/mockups/${r.id}`}
          lead={<Thumb review={r} />}
          title={r.title}
          detail={r.questions.map((q) => q.ask).join(" · ") || undefined}
          meta={[
            r.status === "archived" ? (
              <State tone="idle">Archived</State>
            ) : r.status === "answered" ? (
              <State tone="ok">Answered</State>
            ) : (
              <State tone="attention">Waiting on you</State>
            ),
            plural(r.questions.length, "question"),
            noteCount(r.notes) ? plural(noteCount(r.notes), "note") : null,
            r.frame === "phone" ? "Phone" : "Desktop",
          ]}
          trail={dateLabel(r.date)}
        />
      ))}
    </Rows>
  );
}

// A tiny live copy of the review's first screen, 72px tall, in its frame's shape, centered in a slot as wide as a
// desktop one so titles line up. It can't be clicked or focused.
const THUMB_H = 72;
function Thumb({ review: r }: { review: MockupReview }) {
  const [W, H] = r.size;
  const scale = THUMB_H / H;
  const [file, hash] = r.screens[0].file.split("#");
  return (
    <span className="mr-thumb-slot" aria-hidden>
      <span className={`mr-thumb mr-thumb-${r.frame}`} style={{ width: Math.round(W * scale), height: THUMB_H }}>
        <iframe
          src={mockupHref(`${r.dir}/${file}`) + (hash ? `#${hash}` : "")}
          sandbox="allow-scripts"
          loading="lazy"
          tabIndex={-1}
          width={W}
          height={H}
          style={{ transform: `scale(${scale})` }}
        />
      </span>
    </span>
  );
}
