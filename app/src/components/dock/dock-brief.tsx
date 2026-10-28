"use client";
import { Flow, Stats } from "@/components/brief-blocks";
import { ChatMarkdown } from "@/components/chat-markdown";
import { parseBrief } from "@/lib/brief";
import { parseCard, type Card } from "@/lib/options";

// An agent reply in the dock, read like a thread message (lib/brief.ts): callouts and sections on hairlines,
// ```stats as figures, ```flow as steps, an ```options block as a short list. Sized for a narrow column.
export function DockBrief({ body, scope }: { body: string; scope: string }) {
  const brief = parseBrief(body);
  const card = parseCard(body);
  return (
    <div className="brief dock-brief">
      {brief.lead && <ChatMarkdown content={brief.lead} scope={scope} />}
      {brief.blocks.map((b, i) => {
        if (b.type === "md") return <ChatMarkdown key={i} content={b.text} scope={scope} />;
        if (b.type === "stats") return <Stats key={i} items={b.items} />;
        if (b.type === "flow") return <Flow key={i} steps={b.steps} />;
        if (b.type === "reconcile") return null;
        return (
          <section key={i} className={`brief-part is-${b.tone}`}>
            <h4 className={`brief-label tone-${b.tone}`}>
              <i aria-hidden />
              {b.label}
            </h4>
            {b.text && (
              <div className="brief-body">
                <ChatMarkdown content={b.text} scope={scope} />
              </div>
            )}
          </section>
        );
      })}
      {card && <Options card={card} />}
    </div>
  );
}

function Options({ card }: { card: Card }) {
  return (
    <section className="dock-options">
      {card.ask && <p className="dock-options-ask">{card.ask}</p>}
      <ol>
        {card.options.map((o) => (
          <li key={o.key} className={o.recommended ? "is-pick" : undefined}>
            <b>{o.key}</b>
            <span>
              {o.label}
              {o.recommended && <em> recommended</em>}
              <small>
                {[o.time, o.complexity && `${o.complexity} complexity`, o.growth && `${o.growth} growth`].filter(Boolean).join(" · ")}
                {o.costs && ` · costs ${o.costs}`}
              </small>
            </span>
          </li>
        ))}
      </ol>
      {card.revisit && <p className="dock-options-revisit">Revisit if {card.revisit}</p>}
    </section>
  );
}
