import { readFile } from "node:fs/promises";
import { safeImage } from "@/lib/screens";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = await safeImage(url.searchParams.get("slug") || "", url.searchParams.get("file") || "");
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await readFile(file)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
  });
}
