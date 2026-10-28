// A mockup hub's answer sheet: what the "Copy for the agent" button in a context-notepad decision hub writes,
// sent to an agent in the owner's name. The questions and options are the hub's; each `note:` is the owner typing.
//
//   context-notepad-hub v2 thread=mobile-field-timeapp
//   hub: TimeApp inside FinanceApp on the phone | context-notepad/threads/…/mockups/index.html
//
//   phone-1 = other | Other
//   q: What is the home screen of the phone app?
//   means: None of the options; see the note.
//   note: im not sure about any of these directions …
export type HubAnswer = { key: string; choice: string; label: string; question: string; means: string; note: string };
export type HubSheet = { tool: string; title: string; path: string; answers: HubAnswer[] };

export function parseHub(text: string): HubSheet | undefined {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  const head = lines[0]?.match(/^([a-z0-9-]+) v\d+\b/);
  if (!head) return undefined;
  const sheet: HubSheet = { tool: head[1], title: "", path: "", answers: [] };
  let at: HubAnswer | undefined;
  let field: "question" | "means" | "note" | undefined;
  for (const line of lines.slice(1)) {
    const hub = line.match(/^hub:\s*(.*?)\s*(?:\|\s*(.*))?$/);
    const answer = line.match(/^([a-z0-9][a-z0-9-]*)\s*=\s*(\S+)\s*\|\s*(.*)$/);
    const part = line.match(/^(q|means|note):\s?(.*)$/);
    if (hub && !at) {
      sheet.title = hub[1];
      sheet.path = hub[2] || "";
    } else if (answer) {
      at = { key: answer[1], choice: answer[2], label: answer[3].trim(), question: "", means: "", note: "" };
      sheet.answers.push(at);
      field = undefined;
    } else if (part && at) {
      field = part[1] === "q" ? "question" : (part[1] as "means" | "note");
      at[field] = part[2].trim();
    } else if (at && field && line.trim()) {
      at[field] += `\n${line.trim()}`; // a note that runs over more than one line
    }
  }
  return sheet.answers.length ? sheet : undefined;
}
