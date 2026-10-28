import { FileText, Folder, Image as ImageIcon } from "lucide-react";
import type { AttachmentRef } from "@/lib/attachment-refs";

// What the owner attached to a message (DESIGN.md, Attachments), from the record lines at the end of its body: one chip
// each, "image #3" with a small thumbnail, "pasted #2" or "file #1" with its name. An upload in the repo opens in
// the file viewer (/files/…); a file outside the repo is named, not linked. Material they brought, so plain greys.
export function AttachmentChips({ refs }: { refs: AttachmentRef[] }) {
  if (!refs.length) return null;
  return (
    <div className="att-chips">
      {refs.map((r) => {
        const inner = (
          <>
            {r.kind === "image" && r.href ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.href} alt={r.label} loading="lazy" />
            ) : r.kind === "image" ? (
              <ImageIcon size={13} aria-hidden />
            ) : r.kind === "folder" ? (
              <Folder size={13} aria-hidden />
            ) : (
              <FileText size={13} aria-hidden />
            )}
            <span className="att-label mono">{r.label}</span>
            {r.name && <span className="att-name">{r.name}</span>}
          </>
        );
        const cls = `att-chip is-${r.kind}${r.kind === "image" && r.href ? " has-thumb" : ""}`;
        return r.href ? (
          <a key={r.label} href={r.href} target="_blank" rel="noreferrer" className={cls} title={r.path}>
            {inner}
          </a>
        ) : (
          <span key={r.label} className={cls} title={r.path}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
