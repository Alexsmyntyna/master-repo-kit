import type { Metadata } from "next";
import { Archivo, Geist_Mono, Newsreader } from "next/font/google";
import { Shell } from "@/components/shell";
import { getOwner } from "@/lib/owner";
import { getCompanies, getQueue } from "@/lib/repository";
import { getThreads } from "@/lib/threads";
import { getIdeas } from "@/lib/ideas";
import { getCompanyInfo } from "@/lib/company";
import { getCalendarItems, needsAttention } from "@/lib/calendar";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/shell.css";
import "../styles/ds.css";
import "../styles/instruments.css";

// Self-hosted at build time by next/font; the browser never contacts a font service.
// Archivo for the interface (its width axis gives the semi-condensed display cut), Geist Mono for anything read from
// code, Newsreader for the owner's own words.
const sans = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-serif" });
export async function generateMetadata(): Promise<Metadata> {
  const owner = await getOwner();
  return {
    title: { default: "Board · Master Repo", template: "%s · Master Repo" },
    description: owner.short === "You" ? "Your projects and decisions" : `${owner.short}’s projects and decisions`,
    robots: { index: false, follow: false },
  };
}
export const dynamic = "force-dynamic";
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [companies, queue, threads, owner, parent, calendar, ideas] = await Promise.all([
    getCompanies(),
    getQueue(),
    getThreads(),
    getOwner(),
    getCompanyInfo(),
    getCalendarItems(),
    getIdeas(),
  ]);
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <Shell
          owner={owner.name}
          companyName={parent.name}
          companies={companies.map(({ id, name }) => ({ id, name }))}
          awaitingCount={threads.filter((t) => ["awaiting-alex", "awaiting-owner"].includes(t.status)).length}
          calendarCount={needsAttention(calendar.items, calendar.today)}
          openThreadCount={threads.filter((t) => t.status !== "closed" && t.status !== "decided").length}
          ideaCount={ideas.length}
          runningCount={threads.filter((t) => t.running?.alive).length}
          queueCount={
            queue.filter((q) =>
              ["open", "in_progress", "in-progress"].includes(String(q.meta.status || "open")),
            ).length
          }
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
