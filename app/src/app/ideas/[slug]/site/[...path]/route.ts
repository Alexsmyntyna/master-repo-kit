import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { contentTypes, ideaDir, safeSitePath } from "@/lib/ideas";

export const dynamic = "force-dynamic";

// An idea's standalone page is plain HTML/CSS/JS in ideas/<slug>/site/. Served as-is, so relative links from
// index.html (styles.css, assets/x.svg) resolve under the same route. Never leaves that folder.
const missing = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug, path: segments } = await params;
  const clean = safeSitePath(segments.map((s) => decodeURIComponent(s)));
  const ext = path.extname(clean || "").toLowerCase();
  if (!clean || !safeSitePath(slug) || !contentTypes[ext]) return missing();
  try {
    const dir = await realpath(path.join(ideaDir(slug), "site"));
    const file = await realpath(path.join(dir, clean));
    // Symlinks must not lead out of the folder either.
    if (!file.startsWith(dir + path.sep) || !(await stat(file)).isFile()) return missing();
    // Documents (HTML, SVG) run sandboxed with an opaque origin, so an idea page's scripts can't call the
    // app's own routes or read its storage while sharing 127.0.0.1:3100.
    const active = ext === ".html" || ext === ".htm" || ext === ".svg";
    return new Response(new Uint8Array(await readFile(file)), {
      headers: {
        "Content-Type": contentTypes[ext],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(active ? { "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox" } : {}),
      },
    });
  } catch {
    return missing();
  }
}
