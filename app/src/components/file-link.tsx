"use client";
import { useState, useTransition } from "react";
import { openFile } from "@/app/files/actions";
import "@/styles/prose.css";

// A file path in a summary: click to open it on this Mac (pages in the browser, code in Zed).
export function FileLink({ scope, file }: { scope: string; file: string }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`file-link${note && note !== "Opened" && note !== "Opened in Zed" ? " is-missing" : ""}`}
      title={note || "Open on this Mac"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await openFile(scope, file);
          setNote(r.ok || r.error || "");
        })
      }
    >
      <code>{file}</code>
      {note && <span className="file-note">{note}</span>}
    </button>
  );
}
