// What the owner attached to a message, as the record lines tools/converse.py writes at the end of its body (DESIGN.md,
// Attachments): `[image #3](holding/uploads/…/x.png)`, `[pasted #2: its first line](…)`, `[file #1: name.pdf](…)`,
// `[folder #1: name/](…)`. Numbers count per kind across the thread, the same ones the agent's prompt lists.
// Pure (safe in client code).
import { uploadHref } from "./file-paths";

export type AttachmentKind = "image" | "pasted" | "file" | "folder";
export type AttachmentRef = {
  kind: AttachmentKind;
  n: number;
  label: string; // "image #3"
  name: string; // a paste's first line, a file's name; "" for an image
  path: string; // repo-relative inside Master-Repo, absolute outside it
  href?: string; // the file viewer (/files/…) for an upload in the repo
};

const LINE = /^\[(image|pasted|file|folder) #(\d+)(?:: ([^\]\n]*))?\]\((?:<([^>\n]+)>|([^)\s]+))\)$/;

// Splits a stored body into the owner's words and the record lines after them (the last lines, after a blank line).
// A body with no such block comes back whole.
export function splitAttachmentRefs(body: string): { text: string; refs: AttachmentRef[] } {
  const lines = body.replace(/\s+$/, "").split("\n");
  let i = lines.length;
  while (i > 0 && LINE.test(lines[i - 1].trim())) i--;
  if (i === lines.length || (i > 0 && lines[i - 1].trim() !== "")) return { text: body, refs: [] };
  const refs = lines.slice(i).map((line): AttachmentRef => {
    const m = line.trim().match(LINE)!;
    const kind = m[1] as AttachmentKind;
    const path = m[4] || m[5];
    const href = uploadHref(path);
    return { kind, n: Number(m[2]), label: `${kind} #${m[2]}`, name: (m[3] || "").trim(), path, ...(href ? { href } : {}) };
  });
  return { text: lines.slice(0, i).join("\n").trim(), refs };
}

// What a path attached in the composer is, before it's sent (converse.py `attachment` decides for the record).
export function attachmentKind(path: string): AttachmentKind {
  if (path.endsWith("/")) return "folder";
  if (/\.(png|jpe?g|gif|webp|heic)$/i.test(path)) return "image";
  if (/\/holding\/uploads\/[^/]+\/[0-9a-z]+-pasted-[^/]*\.(md|txt)$/.test(path)) return "pasted";
  return "file";
}

// The repo-relative upload inside an absolute path the composer holds (…/holding/uploads/<date>/<file>), or undefined.
export function uploadOf(abs: string): string | undefined {
  return abs.match(/(?:^|\/)(holding\/uploads\/\d{4}-\d{2}-\d{2}\/[\w.-]+)$/)?.[1];
}

// A file's name as they gave it: an upload's time stamp (lib/attachments.ts saveUploads) and "pasted-" dropped.
export function attachmentName(path: string): string {
  const name = path.replace(/\/$/, "").split("/").pop() || path;
  return uploadOf(path) ? name.replace(/^[0-9a-z]{6,10}-/, "").replace(/^pasted-/, "") : name;
}
