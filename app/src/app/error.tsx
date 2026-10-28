"use client";
import { PageHeader } from "@/components/ds";
import "@/styles/more.css";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="oops">
      <PageHeader
        title="Couldn't load"
        actions={
          <button onClick={reset} className="button primary">
            Try again
          </button>
        }
      />
      {error?.message && <p className="code-text oops-detail">{error.message}</p>}
    </div>
  );
}
