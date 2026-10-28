import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { getCompanies } from "@/lib/repository";
import { getPortfolio } from "@/lib/pulse";
import { PageHeader } from "@/components/ds";
import { NewThread } from "@/components/composer";

export const metadata = { title: "New thread" };

export default async function NewThreadPage({ searchParams }: { searchParams: Promise<{ scope?: string; preset?: string; mode?: string; title?: string }> }) {
  const [{ scope, preset, mode, title }, companies, portfolio] = await Promise.all([searchParams, getCompanies(), getPortfolio()]);
  // Talking moved to the chat dock; an old "Talk" link opens it instead of a form.
  if (mode === "talk") redirect(scope && companies.some((c) => c.id === scope) ? `/companies/${scope}?chat=open` : "/?chat=open");
  const projects = companies.map((c) => ({
    id: c.id,
    name: c.name,
    focus: portfolio.focus.includes(c.id),
    repos: (Array.isArray(c.repos) ? c.repos : []).map((r) => String((r as { path?: string }).path || "")).filter(Boolean),
  }));
  const initial = scope && (scope === "holding" || projects.some((p) => p.id === scope)) ? scope : "holding";
  return (
    <div className="new-thread-page">
      <Link href="/threads" className="back-link">
        <ArrowLeft size={14} /> All threads
      </Link>
      <PageHeader title="New thread" />
      <NewThread
        projects={projects}
        initialScope={initial}
        initialTitle={preset === "screens" ? "Map the screens" : String(title || "").slice(0, 120)}
        initialBody={
          preset === "screens"
            ? "Map every screen and meaningful state of this app and write companies/<slug>/screens/screens.json, following skills/screens.md. Say which adapter fits (web routes, or the project's own capture pipeline) and what's needed to capture with test data instead of real data."
            : ""
        }
      />
    </div>
  );
}
