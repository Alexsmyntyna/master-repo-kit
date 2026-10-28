import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_PATH } from "@/lib/file-paths";
import { repoRoot } from "@/lib/repository";

// The file viewer: /files/holding/uploads/<date>/<file>, a file the owner attached (lib/attachments.ts saveUploads).
// Serves only files under holding/uploads/ (a path or symlink leading anywhere else is a 404). Images and PDFs show
// in the browser, text (a long paste) as plain text, anything else downloads; nothing is ever rendered as a page.
const INLINE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};
const TEXT = new Set([".md", ".txt", ".json", ".csv", ".log"]);

export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const rel = (await ctx.params).path.join("/");
  if (!UPLOAD_PATH.test(rel)) return new Response("Not found", { status: 404 });
  try {
    const base = await realpath(path.join(repoRoot, "holding", "uploads"));
    const file = await realpath(path.join(repoRoot, rel));
    if (!file.startsWith(base + path.sep)) return new Response("Not found", { status: 404 });
    const ext = path.extname(file).toLowerCase();
    const headers: Record<string, string> = { "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" };
    if (INLINE[ext]) headers["Content-Type"] = INLINE[ext];
    else {
      headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
      if (TEXT.has(ext)) headers["Content-Type"] = "text/plain; charset=utf-8";
      else {
        headers["Content-Type"] = "application/octet-stream";
        headers["Content-Disposition"] = `attachment; filename="${path.basename(file).replace(/"/g, "")}"`;
      }
    }
    return new Response(new Uint8Array(await readFile(/* turbopackIgnore: true */ file)), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
