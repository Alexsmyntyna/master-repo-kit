import { getCompanies, getQueue } from "@/lib/repository";
import { PageHeader } from "@/components/ds";
import { QueueForm } from "@/components/queue-form";
import { QueueList } from "@/components/queue-list";
import "@/styles/more.css";

export const metadata = { title: "Queue" };

export default async function Queue() {
  const [companies, queue] = await Promise.all([getCompanies(), getQueue()]);
  const open = queue.filter((q) => ["open", "in_progress", "in-progress"].includes(String(q.meta.status || "open"))).length;
  return (
    <>
      <PageHeader title="Queue" meta={[`${open} open`, `${queue.length} saved`]} />
      <QueueForm companies={companies.map(({ id, name }) => ({ id, name }))} />
      <QueueList docs={queue} names={Object.fromEntries(companies.map((c) => [c.id, c.name]))} />
    </>
  );
}
