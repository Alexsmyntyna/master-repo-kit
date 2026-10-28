import Link from "next/link";
import { getCompanies } from "@/lib/repository";
import { allCards, dialsOf } from "@/lib/cards";
import { ensureRetryWaiter } from "@/lib/spawn";
import { BoardHead, BoardRow, DialStrip } from "@/components/card";
import { Empty, PageHeader } from "@/components/ds";
import { getSnapshot } from "@/lib/wiki";

const today = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

// The board: one row per project card (companies/<slug>/card.json), what's owed or costing without moving first.
export default async function Board() {
  const [companies, cards] = await Promise.all([
    getCompanies(),
    allCards(),
    ensureRetryWaiter(), // a slept Mac's queue of runs waiting out the usage limit drains again
  ]);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const snapshots = new Map(await Promise.all(cards.map(async (c) => [c.slug, await getSnapshot(c.slug)] as const)));
  const unwritten = cards.filter((c) => !c.written).length;
  return (
    <div className="board-page">
      <PageHeader kicker={today()} title="Board" meta={[`${cards.length} projects`, unwritten > 0 && `${unwritten} without a card`]} />
      <DialStrip dials={dialsOf(cards)} />
      {cards.length ? (
        <div className="board">
          <BoardHead />
          {cards.map((c) => (
            <BoardRow key={c.slug} card={c} name={names.get(c.slug) || c.slug} snapshot={snapshots.get(c.slug)} />
          ))}
        </div>
      ) : (
        <Empty>No projects yet</Empty>
      )}
      <p className="board-foot">
        Activity, queue and direction are on the <Link href="/overview">Overview</Link>
      </p>
    </div>
  );
}
