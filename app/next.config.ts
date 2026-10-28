import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  turbopack: { root: path.resolve(process.cwd()) },
  devIndicators: false,
  // The spelling dictionaries read their .aff/.dic files next to their own module (src/lib/spell.ts).
  serverExternalPackages: ["nspell", "dictionary-en", "dictionary-en-gb"],
  // Images attached to thread messages are uploaded through server actions.
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
  // The Vision page became the parent company's area (/company); its prose lives at /company/vision.
  async redirects() {
    return [{ source: "/vision", destination: "/company", permanent: false }];
  },
};
export default config;
