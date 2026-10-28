import Link from "next/link";
import { notFound } from "next/navigation";
import { getHoldingPage } from "@/lib/wiki";
import { getCompanyInfo } from "@/lib/company";
import { label } from "@/lib/model";
import { WikiArticle } from "@/components/wiki";

type Params = Promise<{ page: string[] }>;

// A page of the parent company's wiki (holding/wiki/): /company/<front> or /company/<path>.
async function load(params: Params) {
  const { page } = await params;
  return getHoldingPage(page.map(decodeURIComponent).join("/"));
}

export async function generateMetadata({ params }: { params: Params }) {
  const page = await load(params);
  return { title: page ? `${page.title} · Company` : "Page not found" };
}

export default async function CompanyWikiPage({ params }: { params: Params }) {
  const [page, info] = await Promise.all([load(params), getCompanyInfo()]);
  if (!page) notFound();
  return (
    <WikiArticle
      page={page}
      kicker={
        <>
          <Link href="/company">{info.name || "Parent company"}</Link> / {label(page.kind)}
        </>
      }
    />
  );
}
