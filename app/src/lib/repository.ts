import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { documentsIn, parseDocument, readContent } from "./files";
import { recordOf, type Company } from "./model";

// The code (this app, tools/, agents/) is the checkout the app runs from. The data (companies/, holding/, …) is
// MASTER_REPO_ROOT when set, otherwise that same checkout. See DATA.md and app/README.md.
export const codeRoot = path.resolve(process.cwd(), "..");
export const repoRoot = process.env.MASTER_REPO_ROOT?.trim()
  ? path.resolve(process.env.MASTER_REPO_ROOT.trim().replace(/^~(?=$|\/)/, process.env.HOME || "~"))
  : codeRoot;
// A Python tool that ships with the app, and the environment every Python call gets, so tools/paths.py resolves
// the same data directory the app reads.
export const toolPath = (name: string) => path.join(codeRoot, "tools", name);
export const pythonEnv = (): NodeJS.ProcessEnv => ({ ...process.env, MASTER_REPO_ROOT: repoRoot });
export const readJson = cache(async (relative: string): Promise<unknown> =>
  JSON.parse(await readContent(repoRoot, relative)),
);
export const getDocument = cache(async (relative: string) =>
  parseDocument(relative, await readContent(repoRoot, relative)),
);
export const getCompanies = cache(async (): Promise<Company[]> => {
  const entries = await readdir(path.join(repoRoot, "companies"), {
    withFileTypes: true,
  });
  const companies = await Promise.all(
    entries
      .filter(
        (e) =>
          e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."),
      )
      .map(async (e) => {
        const data = recordOf(
          await readJson(`companies/${e.name}/company.json`),
        );
        if (data.id !== e.name || typeof data.name !== "string")
          throw new Error(`Invalid company model: ${e.name}`);
        return data as Company;
      }),
  );
  return companies.sort((a, b) => a.name.localeCompare(b.name));
});
export const getCompany = cache(async (slug: string) =>
  (await getCompanies()).find((c) => c.id === slug),
);
export const getQueue = cache(() => documentsIn(repoRoot, "queue"));
// Skills are skills/<name>.md; INDEX.md is generated from them by tools/skills.py.
export const getSkills = cache(async () =>
  (await documentsIn(repoRoot, "skills"))
    .filter((d) => !d.path.endsWith("/INDEX.md"))
    .sort((a, b) => a.title.localeCompare(b.title)),
);
export const getReviews = cache(async (slug: string) => {
  if (!(await getCompany(slug))) return [];
  return documentsIn(repoRoot, `companies/${slug}/reviews`);
});
export const getNotes = cache(async (slug: string) => {
  if (!(await getCompany(slug))) return [];
  return documentsIn(repoRoot, `companies/${slug}/notes`);
});
export async function getActiveCompanies() {
  const [direction, companies] = await Promise.all([
    getDocument("holding/direction.md"),
    getCompanies(),
  ]);
  const section =
    direction.content.split("## Active conversations")[1]?.split("\n## ")[0] ||
    "";
  return companies.filter((c) =>
    section.includes(`companies/${c.id}/company.json`),
  );
}
// Dated reports agents write into the project (companies/<slug>/reports/<YYYY-MM-DD>-<topic>.md), newest first.
export const getReports = cache(async (slug: string) => {
  if (!(await getCompany(slug))) return [];
  return documentsIn(repoRoot, `companies/${slug}/reports`);
});
// Read the same ordered file inventory as inbox context and the rules audit.
export const getStandards = cache(async (project?: string) => {
  const { stdout } = await promisify(execFile)("python3", [toolPath("rules.py"), "load", "--json", ...(project ? ["--project", project] : [])],
    { env: pythonEnv(), maxBuffer: 8 * 1024 * 1024 });
  const records = JSON.parse(stdout) as { file: string }[];
  return Promise.all([...new Set(records.map((r) => r.file))].map((file) => getDocument(file)));
});
