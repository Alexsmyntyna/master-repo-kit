import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, readContent } from "@/lib/files";
import { repoRoot } from "@/lib/repository";

const types: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
};

// Serves an image only if a thread message lists it as an attachment.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const message = url.searchParams.get("message") || "";
  const i = Number(url.searchParams.get("i"));
  if (!/^(companies\/[a-z0-9-]+|holding)\/threads\/[a-z0-9-]+\/\d{3}-[a-z]+\.md$/.test(message) || !Number.isInteger(i))
    return new Response("Not found", { status: 404 });
  try {
    const doc = parseDocument(message, await readContent(repoRoot, message));
    const a = (Array.isArray(doc.meta.attachments) ? doc.meta.attachments : [])[i] as { path?: string; kind?: string };
    const type = types[path.extname(a?.path || "").toLowerCase()];
    if (!a?.path || a.kind !== "image" || !type) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(await readFile(a.path)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
