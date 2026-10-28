"use server";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { repoRoot } from "@/lib/repository";

export type VisionState = { error?: string; done?: string };
const file = path.join(repoRoot, "holding", "vision.md");

// Only ever writes holding/vision.md: keeps the frontmatter, bumps `updated`, replaces the body.
export async function saveVision(_previous: VisionState, form: FormData): Promise<VisionState> {
  const body = String(form.get("body") || "").replace(/\r\n/g, "\n").trim();
  if (!body) return { error: "The vision can’t be empty." };
  if (body.length > 30000) return { error: "Keep it under 30,000 characters." };
  let head = "---\ntitle: Vision\n---";
  try {
    head = (await readFile(file, "utf8")).match(/^---\n[\s\S]*?\n---/)?.[0] || head;
  } catch {}
  const today = new Date().toISOString().slice(0, 10);
  head = /\nupdated:.*\n/.test(head) ? head.replace(/\nupdated:.*\n/, `\nupdated: ${today}\n`) : head.replace(/\n---$/, `\nupdated: ${today}\n---`);
  await writeFile(file, `${head}\n\n${body}\n`);
  revalidatePath("/company", "layout");
  return { done: "Saved" };
}
