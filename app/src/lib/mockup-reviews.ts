import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { frontmatter as matter } from "./frontmatter";
import { DESKTOP_FRAME, MOCKUP_PATH, REVIEW_ID, reviewOf, sniffFrame, toReview, type MockupFrame, type MockupReview } from "./mockups";
import { getCompany, repoRoot } from "./repository";

// A project's mockup reviews, newest first: every companies/<slug>/mockups/<id>/ with a review.md.
const read = (file: string) => readFile(file, "utf8").catch(() => "");

export const getMockupReview = cache(async (slug: string, id: string): Promise<MockupReview | undefined> => {
  if (!REVIEW_ID.test(id) || !(await getCompany(slug))) return undefined;
  const dir = path.join(repoRoot, "companies", slug, "mockups", id);
  const raw = await read(path.join(dir, "review.md"));
  if (!raw) return undefined;
  const review = matter(raw);
  const notes = await read(path.join(dir, "notes.md"));
  return toReview(slug, id, review.data, review.content, notes ? matter(notes).data : undefined);
});

export const getMockupReviews = cache(async (slug: string): Promise<MockupReview[]> => {
  if (!(await getCompany(slug))) return [];
  const entries = await readdir(path.join(repoRoot, "companies", slug, "mockups"), { withFileTypes: true }).catch(() => []);
  const reviews = await Promise.all(
    entries.filter((e) => e.isDirectory() && REVIEW_ID.test(e.name)).map((e) => getMockupReview(slug, e.name)),
  );
  return reviews.filter((r): r is MockupReview => !!r).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
});

// The device a mockups-block file is drawn for: its review's frame, or sniffed from the file (lib/mockups.ts sniffFrame).
export const getMockupFrame = cache(async (rel: string): Promise<MockupFrame> => {
  const r = reviewOf(rel);
  const review = r && (await getMockupReview(r.slug, r.id));
  if (review) return { frame: review.frame, size: review.size };
  if (!MOCKUP_PATH.test(rel)) return DESKTOP_FRAME;
  return sniffFrame(await read(path.join(repoRoot, rel)));
});
