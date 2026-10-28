import Link from "next/link";
import { getCompanies, getDocument } from "@/lib/repository";
import { amountInput, formatAmount, getMoney } from "@/lib/company";
import { getWiki, HOLDING, sectionOf } from "@/lib/wiki";
import { dateLabel } from "@/lib/model";
import { Markdown } from "@/components/markdown";
import { ProjectMark } from "@/components/ui";
import { GoalsForm, ProductMoneyRow, ProductsForm } from "@/components/company";
import { Empty, More, PageHeader, Said, Section, Source, State, type Tone } from "@/components/ds";
import "@/styles/company.css";

export const metadata = { title: "Money · Company" };

const stateLabels: Record<string, [string, Tone | undefined]> = {
  earning: ["Earning", "ok"],
  free: ["Free", "idle"],
  "not-yet": ["Not yet", "idle"],
  unknown: ["Unknown", undefined],
};

// Earnings: what the record says about income, the company goal and each product's goal and actual, all typed
// by the owner (holding/money.json). No figure is guessed; an empty one is "—".
export default async function CompanyMoney() {
  const [money, companies, vision, pages] = await Promise.all([
    getMoney(),
    getCompanies(),
    getDocument("holding/vision.md").catch(() => undefined),
    getWiki(HOLDING),
  ]);
  const byId = Object.fromEntries(companies.map((c) => [c.id, c]));
  const table = vision ? sectionOf(vision.content, "Money and legal") : "";
  const open = pages.find((p) => p.page === "index");
  // The money questions from the story's Open list: the state and the accountant (the name has its own page).
  const questions = (open ? sectionOf(open.content, "Open") : "")
    .split("\n")
    .filter((l) => /state|accountant/i.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, "- "))
    .join("\n");
  const products = Object.entries(money.products);
  const sum = (key: "goal_monthly" | "actual_monthly") => {
    const set = products.map(([, p]) => p[key]).filter((n): n is number => n !== null);
    return set.length ? set.reduce((a, b) => a + b, 0) : null;
  };

  return (
    <div className="company-money">
      <PageHeader
        title="Money"
        meta={[
          money.updated && `updated ${dateLabel(money.updated)}`,
          `${products.length} products`,
          <span key="f" className="code-text">holding/money.json</span>,
        ]}
      />

      <p className="money-today">
        Today: all freelance income, nothing deducted <Source who="owner" date="2026-10-11" cite="holding/threads/chat/001-owner.md" label="You, chat" />
      </p>
      <Said text="currently its just all freelance work but I cant deduct anything ect." date="2026-10-11" where="Chat" href="/threads/holding/chat" />

      <Section title="Company goal" note={money.goals.note && <span className="faint">{money.goals.note}</span>}>
        <GoalsForm year={amountInput(money.goals.year)} monthly={amountInput(money.goals.monthly)} />
      </Section>

      <Section
        title="Products"
        note={
          <span>
            goals {formatAmount(sum("goal_monthly"), money.currency)} · actual {formatAmount(sum("actual_monthly"), money.currency)} per month
          </span>
        }
      >
        {products.length ? (
          <ProductsForm
            head={
              <div className="money-row money-head" role="row">
                <span>Product</span>
                <span>How it earns</span>
                <span>State</span>
                <span className="num">Goal / month</span>
                <span className="num">Actual / month</span>
              </div>
            }
          >
            {products.map(([slug, p]) => {
              const c = byId[slug];
              const [stateLabel, tone] = stateLabels[p.state] || stateLabels.unknown;
              return (
                <ProductMoneyRow key={slug} slug={slug} goal={amountInput(p.goal_monthly)} actual={amountInput(p.actual_monthly)}>
                  <span className="money-name">
                    {c ? (
                      <Link href={`/companies/${slug}`} className="ptable-title">
                        <ProjectMark company={c} />
                        {c.name}
                      </Link>
                    ) : (
                      slug
                    )}
                  </span>
                  <span className={`money-model ${p.model === "unknown" ? "faint" : ""}`}>
                    {p.model === "unknown" ? "Unknown" : p.model}
                    {p.note && <small>{p.note}</small>}
                  </span>
                  <span>
                    <State tone={tone}>{stateLabel}</State>
                  </span>
                </ProductMoneyRow>
              );
            })}
          </ProductsForm>
        ) : (
          <Empty>No products</Empty>
        )}
      </Section>

      <Section
        title="Money and legal"
        note={vision && <Source who={String(vision.meta.written_by || "agent")} date={vision.meta.updated} cite="holding/vision.md" />}
        action={<More href="/company/vision">Vision</More>}
      >
        {table ? (
          <div className="story-prose">
            <Markdown content={table} path="holding/vision.md" />
          </div>
        ) : (
          <Empty>Not in the vision yet</Empty>
        )}
      </Section>

      <Section title="Open" action={<More href="/company/entity">Entity</More>}>
        {questions ? (
          <div className="story-prose">
            <Markdown content={questions} path="holding/wiki/index.md" />
          </div>
        ) : (
          <Empty>Nothing open</Empty>
        )}
      </Section>
    </div>
  );
}
