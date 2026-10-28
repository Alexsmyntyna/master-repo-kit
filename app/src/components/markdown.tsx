import ReactMarkdown from "react-markdown";
import "@/styles/prose.css";
import remarkGfm from "remark-gfm";
import { documentHref } from "@/lib/files";
import { looksLikePath, scopeOf } from "@/lib/file-paths";
import { FileLink } from "@/components/file-link";
function headingId(children: unknown): string {
  return String(children)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}
export function Markdown({ content, path }: { content: string; path: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const safe = href ? documentHref(href, path) : undefined;
            return safe ? (
              <a
                href={safe}
                {...(safe.startsWith("http")
                  ? { target: "_blank", rel: "noreferrer" }
                  : {})}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          // Inline code that is a file path opens that file (inside this document's project folders only).
          code: ({ className, children }) => {
            const text = String(children);
            return !className && looksLikePath(text) ? (
              <FileLink scope={scopeOf(path)} file={text} />
            ) : (
              <code className={className}>{children}</code>
            );
          },
          img: ({ alt }) => (
            <span className="muted">{alt || "Linked image"}</span>
          ),
          h2: ({ children }) => <h2 id={headingId(children)}>{children}</h2>,
          h3: ({ children }) => <h3 id={headingId(children)}>{children}</h3>,
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
