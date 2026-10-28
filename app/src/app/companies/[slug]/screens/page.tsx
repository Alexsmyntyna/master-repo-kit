import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany } from "@/lib/repository";
import { getScreens } from "@/lib/screens";
import { ScreensGallery, ScreensTask } from "@/components/screens-gallery";
import { Empty, PageHeader, Stats } from "@/components/ds";
import "@/styles/project-pages.css";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCompany((await params).slug);
  return { title: c ? `${c.name} screens` : "Screens" };
}

export default async function ProjectScreens({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();
  const screens = await getScreens(slug);
  if (!screens) {
    return (
      <article className="pp">
        <PageHeader title="Screens" />
        <Empty
          action={
            <Link className="button secondary" href={`/threads/new?scope=${slug}&preset=screens`}>
              Map screens
            </Link>
          }
        >
          No screen map
        </Empty>
      </article>
    );
  }
  const all = screens.features.flatMap((f) => f.surfaces);
  const captured = all.filter((s) => screens.latest[s.id]).length;
  const open = screens.notes.filter((n) => n.status === "open");
  const lastRun = screens.runs.at(-1);
  const share = captured / Math.max(1, all.length);
  return (
    <article className="pp">
      <PageHeader
        title="Screens"
        meta={[
          screens.adapter === "delegate" ? "project pipeline" : "Master-Repo capture",
          lastRun ? (
            <span key="r">
              last run <span className="num">{lastRun.run}</span> · {lastRun.status}
            </span>
          ) : (
            "never run"
          ),
        ]}
        actions={
          <>
            <ScreensTask slug={slug} task="capture" label="Capture" />
            <ScreensTask slug={slug} task="analyze" label="Review" />
            <ScreensTask slug={slug} task="sync" label="Sync" />
          </>
        }
      />
      <Stats
        items={[
          { value: `${captured} / ${all.length}`, label: "captured" },
          { value: screens.features.length, label: "features" },
          { value: open.length, label: "open notes", tone: open.length ? "attention" : undefined },
        ]}
      />
      <div className="scov" role="img" aria-label={`${Math.round(share * 100)}% captured`}>
        <i style={{ width: `${share * 100}%` }} />
      </div>
      <ScreensGallery slug={slug} features={screens.features} latest={screens.latest} notes={screens.notes} />
    </article>
  );
}
