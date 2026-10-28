import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCompanies, getDocument, readJson } from "@/lib/repository";
import { Markdown } from "@/components/markdown";
import { Value } from "@/components/value";
import { PageHeader } from "@/components/ds";
import { dateLabel, label } from "@/lib/model";
import "@/styles/more.css";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return { title: path.at(-1)?.replace(/\.(md|json)$/, " ") || "Document" };
}
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const relative = (await params).path.join("/");
  let doc, json;
  try {
    if (relative.endsWith(".json")) json = await readJson(relative);
    else doc = await getDocument(relative);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      /Unsupported document|Linked files/.test(message)
    )
      notFound();
    throw error;
  }
  const parent = relative.startsWith("companies/")
    ? `/companies/${relative.split("/")[1]}`
    : relative.startsWith("queue/")
      ? "/queue"
      : relative.startsWith("skills/")
        ? "/skills"
        : relative.startsWith("guide/")
          ? "/guide"
        : relative.startsWith("identity/")
          ? "/identity"
          : "/";
  const slug = relative.startsWith("companies/") ? relative.split("/")[1] : "";
  const back = parent === "/" ? "Overview" : parent === "/ideas" ? "Ideas" : slug ? (await getCompanies()).find((c) => c.id === slug)?.name || slug : label(parent.slice(1));
  const file = relative.split("/").pop() || relative;
  return (
    <article className="doc-page">
      <Link href={parent} className="back-link">
        <ArrowLeft size={14} /> {back}
      </Link>
      <PageHeader
        kicker={<span className="code-text">{relative}</span>}
        title={doc ? doc.title : file.replace(/\.json$/, "")}
        meta={[
          !!doc?.meta.updated && `updated ${dateLabel(doc.meta.updated)}`,
          !!doc?.meta.status && label(String(doc.meta.status)),
        ]}
      />
      <div className="doc-body">
        {doc ? <Markdown content={doc.content.replace(/^#\s+.+\n*/, "")} path={relative} /> : <Value value={json} />}
      </div>
    </article>
  );
}
