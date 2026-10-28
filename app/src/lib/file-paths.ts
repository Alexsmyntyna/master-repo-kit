// Pure helpers for file paths in summaries (safe to use in client code; opening lives in local-files.ts).

// Which folders a document's file paths can point into, from the document's own path.
export function scopeOf(docPath: string): string {
  const m = docPath.match(/^companies\/([a-z0-9-]+)(?:\/builds\/([a-z0-9-]+))?/);
  return m ? (m[2] ? `build:${m[1]}:${m[2]}` : `project:${m[1]}`) : "master";
}

// Inline code that reads as a path: has a folder separator or a file extension, no spaces.
export function looksLikePath(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 400 || /\s/.test(t) || /^[-$]/.test(t) || /:\/\//.test(t)) return false;
  if (!/^(~\/|\/|\.{1,2}\/)?[\w.@+-]+(\/[\w.@+()-]+)*\/?(:\d+(:\d+)?)?$/.test(t)) return false;
  return t.includes("/") || /\.[a-zA-Z][a-zA-Z0-9]{0,5}(:\d+)*$/.test(t);
}

// A link in agent text that may open inside the app: an app path under a known route, or a repo path with a
// page (appHref). Anything else (protocol-relative, backslash tricks, javascript:, unknown routes) is undefined
// and renders as plain text.
const APP_ROUTES = new Set(["companies", "company", "threads", "documents", "decisions", "vision", "system", "codebases", "queue", "runs", "screens", "skills", "identity", "guide"]);
export function appLink(href: string): string | undefined {
  const h = href.trim();
  if (h.startsWith("/")) {
    if (!/^\/(?![/\\])[^\\\s]*$/.test(h)) return undefined;
    return APP_ROUTES.has(h.slice(1).split(/[/?#]/)[0]) ? h : undefined;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(h) ? undefined : appHref(h);
}

// The parent company's pages live under /company: holding/wiki/index.md is /company, a front drops its
// "fronts/" folder (/company/entity), any other wiki page keeps its path. Static pages (setup, money, vision,
// pages) win over a wiki page of the same name, so the holding wiki never uses those names.
export function holdingWikiHref(page: string): string {
  if (page === "index") return "/company";
  const rest = page.startsWith("fronts/") ? page.slice("fronts/".length) : page;
  return `/company/${rest.split("/").map(encodeURIComponent).join("/")}`;
}
const holdingFiles: Record<string, string> = {
  "holding/vision.md": "/company/vision",
  "holding/setup.json": "/company/setup",
  "holding/money.json": "/company/money",
  "holding/company.json": "/company",
};
// The /company page for a holding file, or undefined.
export function holdingFileHref(file: string): string | undefined {
  const m = file.match(/^holding\/wiki\/(.+)\.md$/);
  return m ? holdingWikiHref(m[1]) : holdingFiles[file];
}

// A file the owner attached (lib/attachments.ts saveUploads: holding/uploads/<date>/<file>) opens in the file viewer
// (app/files/[...path]/route.ts). Nothing else under /files.
export const UPLOAD_PATH = /^holding\/uploads\/\d{4}-\d{2}-\d{2}\/[\w.-]+$/;
export function uploadHref(file: string): string | undefined {
  const t = file.trim().replace(/^\.\//, "");
  return UPLOAD_PATH.test(t) && !t.split("/").includes("..") ? `/files/${t}` : undefined;
}

// The app page for a repo path an agent mentions (a wiki page, a thread, a mockup, the Board, any document),
// so chat replies link straight to it. undefined when the app has no page for it.
export function appHref(file: string): string | undefined {
  const t = file.trim().replace(/^\.\//, "").replace(/(:\d+)+$/, "").replace(/\/$/, "");
  if (!t || t.startsWith("/") || t.startsWith("~") || t.split("/").includes("..")) return undefined;
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  let m = t.match(/^companies\/([a-z0-9-]+)\/wiki\/(.+)\.md$/);
  if (m) return m[2] === "index" ? `/companies/${m[1]}` : `/companies/${m[1]}/wiki/${enc(m[2])}`;
  m = t.match(/^(?:companies\/([a-z0-9-]+)|holding)\/threads\/([a-z0-9-]+)(?:\/|$)/);
  if (m) return `/threads/${m[1] || "holding"}/${m[2]}`;
  m = t.match(/^companies\/([a-z0-9-]+)\/mockups\/([\w.-]+)(?:\/|$)/);
  if (m) return `/companies/${m[1]}/mockups/${encodeURIComponent(m[2])}`;
  if (/^companies\/[a-z0-9-]+\/builds(?:\/|$)/.test(t)) return `/companies/${t.split("/")[1]}/build`;
  const company = holdingFileHref(t);
  if (company) return company;
  const upload = uploadHref(t);
  if (upload) return upload;
  if (/^(companies|holding|identity|queue|skills|guide|discovery)\/.+\.md$/.test(t)) return `/documents/${enc(t)}`;
  return undefined;
}
