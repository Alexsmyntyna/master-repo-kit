import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { MOCKUP_PATH, withScrollReporter } from "@/lib/mockups";
import { repoRoot } from "@/lib/repository";

// Serves an agent-written mockup. The CSP sandbox gives it an opaque origin: it can draw and run its own inline
// script, but can't reach the app, its cookies, or the network. withScrollReporter lets pins follow its scroll.
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get("path") || "";
  if (!MOCKUP_PATH.test(rel)) return new Response("Not found", { status: 404 });
  try {
    const file = await realpath(path.join(repoRoot, rel));
    if (!file.startsWith((await realpath(repoRoot)) + path.sep)) return new Response("Not found", { status: 404 });
    return new Response(withScrollReporter(await readFile(file, "utf8")), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
