import { OLDER_DAYS } from "@/lib/timeline";

// Marks a document, mockup, build or thread dated over 30 days before the newest of its kind (lib/timeline.ts
// markOlder): probably superseded. The row it sits in dims; the tag says why.
export function OlderTag() {
  return (
    <span className="older-tag" title={`Over ${OLDER_DAYS} days older than the newest of its kind`}>
      older
    </span>
  );
}
