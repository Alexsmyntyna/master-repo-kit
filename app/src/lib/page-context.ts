import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./repository";

// Which conversation a page belongs to and which file stands behind it, so the chat dock (components/dock/)
// talks about the page the owner is looking at: one chat per project, plus one for the parent company's pages.
// `scope` is a project slug or "holding"; `name` and `label` make the dock's chip ("CameraApp · Story");
// `file` is a repo path (relative, existing) or "" when no single file stands behind the page.
export type PageContext = { url: string; scope: string; name: string; file: string; label: string };
const ID = /^[a-z0-9][a-z0-9-]*$/;
const CONTENT = new Set(["companies", "holding", "identity", "queue", "skills", "guide", "discovery"]);

async function exists(rel: string): Promise<boolean> {
  try {
    await stat(path.join(repoRoot, rel));
    return true;
  } catch {
    return false;
  }
}

const first = async (...rels: string[]) => {
  for (const r of rels) if (r && (await exists(r))) return r;
  return "";
};

async function projectName(slug: string): Promise<string | undefined> {
  try {
    const data = JSON.parse(await readFile(path.join(repoRoot, "companies", slug, "company.json"), "utf8"));
    return typeof data.name === "string" ? data.name : slug;
  } catch {
    return undefined;
  }
}

const HOLDING = "Parent company";
const holdingPages: Record<string, [string, string]> = {
  "": ["Overview", "holding/direction.md"],
  vision: ["Vision", "holding/vision.md"], // /vision redirects to /company; kept for old links
  decisions: ["Decisions", "holding/decisions.json"],
  codebases: ["Codebases", "holding/codebases"],
  companies: ["Projects", "holding/portfolio.json"],
  queue: ["Queue", "queue"],
  runs: ["Runs", ""],
  screens: ["Screens", ""],
  skills: ["Skills", "skills/INDEX.md"],
  identity: ["Identity", "identity"],
  guide: ["Guide", "guide"],
  styles: ["Styles", "app/DESIGN.md"],
  threads: ["Threads", ""],
  calendar: ["Calendar", "holding/calendar.json"],
};

const companyPages: Record<string, [string, string]> = {
  "": ["Company", "holding/wiki/index.md"],
  setup: ["Setup", "holding/setup.json"],
  money: ["Money", "holding/money.json"],
  vision: ["Vision", "holding/vision.md"],
  pages: ["Pages", "holding/wiki/index.md"],
};

export async function pageContext(url: string): Promise<PageContext | undefined> {
  let clean: string;
  try {
    clean = decodeURIComponent(url.split(/[?#]/)[0]).replace(/\/+$/, "") || "/";
  } catch {
    return undefined;
  }
  if (!clean.startsWith("/") || clean.split("/").includes("..") || /[\0\\]/.test(clean)) return undefined;
  const parts = clean.split("/").filter(Boolean);
  const href = encodeURI(clean);
  const holding = async (label: string, ...files: string[]) => ({ url: href, scope: "holding", name: HOLDING, label, file: await first(...files) });
  const project = async (slug: string, label: string, ...files: string[]) => {
    const name = ID.test(slug) ? await projectName(slug) : undefined;
    return name ? { url: href, scope: slug, name, label, file: await first(...files) } : holding("This page");
  };

  if (parts[0] === "companies" && parts[1]) {
    const slug = parts[1];
    const base = `companies/${slug}`;
    const tab = parts[2] || "";
    const rest = parts.slice(3).join("/");
    if (tab === "wiki" && rest) return project(slug, "Wiki page", `${base}/wiki/${rest}.md`, `${base}/wiki/${rest}/index.md`);
    if (tab === "mockups" && rest) return project(slug, "Mockup", `${base}/mockups/${parts[3]}/review.md`, `${base}/mockups/${parts[3]}`);
    const tabs: Record<string, [string, string[]]> = {
      "": ["Story", [`${base}/wiki/index.md`, `${base}/story.md`]],
      decisions: ["Decisions", [`${base}/decisions.json`]],
      market: ["Market", [`${base}/market/market.md`, `${base}/market`]],
      screens: ["Screens", [`${base}/screens/screens.json`]],
      build: ["Board", [`${base}/builds`]],
      timeline: ["Timeline", [`${base}/git/snapshot.json`]],
      model: ["Model", [`${base}/company.json`]],
      mockups: ["Mockups", [`${base}/mockups`]],
    };
    const [label, files] = tabs[tab] || ["Project page", [`${base}/company.json`]];
    return project(slug, label, ...files);
  }
  if (parts[0] === "company") {
    // The parent company's area: its own pages, then its wiki (a front first, as /company/<name> resolves).
    const rest = parts.slice(1).join("/");
    const own = companyPages[rest];
    if (own) return holding(own[0], own[1]);
    return holding("Company page", `holding/wiki/fronts/${rest}.md`, `holding/wiki/${rest}.md`, `holding/wiki/${rest}/index.md`);
  }
  if (parts[0] === "threads") {
    const [, scope, id] = parts;
    if (scope && id && ID.test(id) && scope !== "new") {
      const file = `${scope === "holding" ? "holding" : `companies/${scope}`}/threads/${id}/thread.md`;
      return scope === "holding" ? holding("Thread", file) : project(scope, "Thread", file);
    }
    return holding(scope === "new" ? "New thread" : "Threads");
  }
  if (parts[0] === "documents" && CONTENT.has(parts[1] || "")) {
    const file = parts.slice(1).join("/");
    return parts[1] === "companies" && parts[2] ? project(parts[2], "Document", file) : holding("Document", file);
  }
  const [label, file] = holdingPages[parts[0] || ""] || ["This page", ""];
  return holding(label, file);
}
