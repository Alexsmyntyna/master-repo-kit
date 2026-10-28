import Link from "next/link";
import { dateLabel, label } from "@/lib/model";
import { verdictLabels, type Pulse, type Release } from "@/lib/pulse";
import { threadHref, type Thread } from "@/lib/threads";
import { CheckinButton } from "./run-status";
import { KV, Section, State, type Tone } from "./ds";

// company.json is written by agents; only link plain web URLs.
const webUrl = (value?: string | null) => {
  try {
    const u = new URL(value || "");
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};

const verdictTones: Record<string, Tone> = { push: "ok", maintain: "accent", park: "idle", retire: "risk" };

// The project's release: is it published, how it reaches people, what to do with it. Written when the owner
// approves a check-in.
export function ReleaseSection({
  slug,
  release,
  pulse,
  pending,
}: {
  slug: string;
  release?: Release;
  pulse?: Pulse;
  pending?: Thread; // an open check-in
}) {
  const waiting = pending && (
    <Link className={`release-pending ${["awaiting-alex", "awaiting-owner"].includes(pending.status) ? "is-waiting" : ""}`} href={threadHref(pending)}>
      {["awaiting-alex", "awaiting-owner"].includes(pending.status) ? "Check-in waiting" : "Check-in running"} →
    </Link>
  );
  if (!release)
    return (
      <Section title="Release" note="not decided">
        {waiting || <CheckinButton slug={slug} />}
      </Section>
    );
  const landing = webUrl(release.landing_page);
  const rows: [string, React.ReactNode][] = [
    ["Published", label(release.published || "unknown")],
    ["Via", label(release.channel || "undecided")],
    [
      "Landing",
      landing ? (
        <a href={landing} target="_blank" rel="noreferrer">
          {landing.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        release.landing_page || "none"
      ),
    ],
    ["Next check", release.cadence === "none" ? "not scheduled" : release.next_check ? dateLabel(release.next_check) : "—"],
  ];
  return (
    <Section
      title="Release"
      note={release.verdict && <State tone={verdictTones[release.verdict]}>{verdictLabels[release.verdict] || release.verdict}</State>}
    >
      {release.next_step && <p className="release-step">{release.next_step}</p>}
      {waiting}
      <KV items={rows} />
      <p className="release-foot">
        Checked {release.last_check ? dateLabel(release.last_check) : "—"}
        {pulse?.unread ? ` · ${pulse.unread} commits since` : ""}
        {release.thread && (
          <>
            {" · "}
            <Link href={`/threads/${slug}/${release.thread.split("/").pop()}`}>check-in</Link>
          </>
        )}
      </p>
      {!pending && <CheckinButton slug={slug} label="Check in again" />}
    </Section>
  );
}
