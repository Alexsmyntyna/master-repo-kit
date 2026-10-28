import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany } from "@/lib/repository";
import { getWikiPage } from "@/lib/wiki";
import { label } from "@/lib/model";
import { WikiArticle } from "@/components/wiki";

type Params = Promise<{ slug: string; page: string[] }>;

async function load(params: Params) {
  const { slug, page } = await params;
  const name = page.map(decodeURIComponent).join("/");
  if (name === "index") return null;
  return getWikiPage(slug, name);
}

export async function generateMetadata({ params }: { params: Params }) {
  const [page, c] = await Promise.all([load(params), getCompany((await params).slug)]);
  return { title: page ? `${page.title} · ${c?.name}` : "Page not found" };
}

export default async function WikiPageView({ params }: { params: Params }) {
  const page = await load(params);
  if (!page) notFound();
  const c = await getCompany(page.slug);
  return (
    <WikiArticle
      page={page}
      kicker={
        <>
          <Link href={`/companies/${page.slug}`}>{c?.name}</Link> / {label(page.kind)}
        </>
      }
    />
  );
}
