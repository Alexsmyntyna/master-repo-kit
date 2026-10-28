"use client";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import "@/styles/prose.css";
import remarkGfm from "remark-gfm";
import { appHref, appLink, looksLikePath } from "@/lib/file-paths";
import { FileLink } from "@/components/file-link";

// Agent replies in client views (the chat dock): web links open in a new tab, repo paths with a page in the app
// link to it, other file paths open locally.
export function ChatMarkdown({ content, scope }: { content: string; scope: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href && /^https?:\/\//.test(href))
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            const page = href ? appLink(href) : undefined;
            // An attached file (holding/uploads/…) opens in the file viewer, a file rather than a page.
            if (page?.startsWith("/files/"))
              return (
                <a href={page} target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            return page ? <Link href={page}>{children}</Link> : <span>{children}</span>;
          },
          img: ({ alt }) => <span className="muted">{alt || "Image"}</span>,
          code: ({ className, children }) => {
            const text = String(children);
            if (className || !looksLikePath(text)) return <code className={className}>{children}</code>;
            const page = appHref(text);
            if (page?.startsWith("/files/"))
              return (
                <a href={page} target="_blank" rel="noreferrer" className="file-link">
                  <code>{text}</code>
                </a>
              );
            return page ? (
              <Link href={page} className="file-link">
                <code>{text}</code>
              </Link>
            ) : (
              <FileLink scope={scope} file={text} />
            );
          },
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
