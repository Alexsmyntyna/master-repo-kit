import { readFile } from "node:fs/promises";
import path from "node:path";
import { safeShot } from "@/lib/market";

const types: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// Competitor screenshots from tools/market.py.
export async function GET(request: Request) {
  const file = await safeShot(new URL(request.url).searchParams.get("path") || "");
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await readFile(file)), {
    headers: { "Content-Type": types[path.extname(file)] || "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
