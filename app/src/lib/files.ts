import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { frontmatter as matter } from "./frontmatter";
import type { Document } from "./model";
import { holdingFileHref } from "./file-paths";

// Only the workspace's designated content directories are readable through the app.
const roots = new Set([
  "companies",
  "holding",
  "identity",
  "queue",
  "skills",
  "guide",
  "discovery",
  "ideas",
  "standards",
]);
export function contentPath(root: string, relative: string): string {
  const parts = relative.split("/");
  if (
    (!roots.has(parts[0]) && !(parts[0] === "local" && parts[1] === "standards")) ||
    parts.some(
      (p) =>
        !p || p === "." || p === ".." || p.startsWith(".") || p.includes("\\"),
    ) ||
    !/\.(md|json)$/.test(relative)
  ) {
    throw new Error("Unsupported document path");
  }
  return path.join(root, ...parts);
}
export async function safeContentPath(
  root: string,
  relative: string,
): Promise<string> {
  const candidate = contentPath(root, relative);
  const [base, resolved] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  // Reject symlinks even when their target is elsewhere inside the workspace.
  if (resolved !== path.join(base, relative))
    throw new Error("Linked files are not readable");
  return resolved;
}
export async function readContent(
  root: string,
  relative: string,
): Promise<string> {
  return readFile(await safeContentPath(root, relative), "utf8");
}
export function parseDocument(relative: string, raw: string): Document {
  // JSON frontmatter values emitted by the app and the repo's existing YAML are supported.
  const parsed = matter(raw);
  const heading = parsed.content.match(/^#\s+(.+)$/m)?.[1];
  return {
    path: relative,
    title:
      typeof parsed.data.title === "string"
        ? parsed.data.title
        : heading || path.basename(relative, path.extname(relative)),
    meta: parsed.data,
    content: parsed.content.trim(),
  };
}
export async function documentsIn(
  root: string,
  relative: string,
): Promise<Document[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const docs = await Promise.all(
    entries
      .filter(
        (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md",
      )
      .map(async (e) => {
        const name = `${relative}/${e.name}`;
        return parseDocument(name, await readContent(root, name));
      }),
  );
  return docs.sort((a, b) => b.path.localeCompare(a.path));
}
export type QueueInput = { title: string; question: string; project: string };
export async function saveQuestion(
  root: string,
  input: QueueInput,
  allowedProjects: string[],
): Promise<string> {
  const title = input.title.trim(),
    question = input.question.trim(),
    project = input.project.trim();
  if (!title || title.length > 140 || /[\r\n]/.test(title))
    throw new Error("Give the question a title of 1–140 characters.");
  if (!question || question.length > 10000)
    throw new Error("Add a question of 1–10,000 characters.");
  if (project && !allowedProjects.includes(project))
    throw new Error("Choose an existing project or the holding company.");
  const dir = await realpath(path.join(root, "queue"));
  if (dir !== path.join(await realpath(root), "queue"))
    throw new Error("Queue directory must be inside the workspace.");
  const date = new Date().toISOString().slice(0, 10);
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "question";
  const name = `${date}-${slug}-${randomUUID().slice(0, 8)}.md`;
  const header = `---\ntitle: ${JSON.stringify(title)}\nscope: ${project ? "company" : "holding"}\nproject: ${project ? JSON.stringify(project) : "null"}\nstatus: open\noutput: null\nsource: owner\ndate: ${date}\n---\n\n`;
  await writeFile(path.join(dir, name), header + question + "\n", {
    flag: "wx",
  });
  return `queue/${name}`;
}
// Resolve Markdown links within the content viewer, without creating arbitrary file URLs.
export function documentHref(
  href: string,
  current: string,
): string | undefined {
  if (href.startsWith("#") || /^https?:\/\//i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/"))
    return undefined;
  const [target, hash] = href.split("#");
  const relative = path.posix.normalize(
    path.posix.join(path.posix.dirname(current), target),
  );
  try {
    contentPath("/workspace", relative);
  } catch {
    return undefined;
  }
  const wiki = relative.match(/^companies\/([^/]+)\/wiki\/(.+)\.md$/);
  if (wiki) {
    const base =
      wiki[2] === "index"
        ? `/companies/${wiki[1]}`
        : `/companies/${wiki[1]}/wiki/${wiki[2].split("/").map(encodeURIComponent).join("/")}`;
    return `${base}${hash ? `#${hash}` : ""}`;
  }
  const company = holdingFileHref(relative);
  if (company) return `${company}${hash ? `#${hash}` : ""}`;
  return `/documents/${relative.split("/").map(encodeURIComponent).join("/")}${hash ? `#${hash}` : ""}`;
}
