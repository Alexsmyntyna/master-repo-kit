// Slash commands in the chat dock: things that start work elsewhere instead of a chat message.
export type Command = { name: string; arg?: string; hint: string; holdingHint?: string; projectOnly?: boolean };

export const commands: Command[] = [
  { name: "decide", arg: "subject", hint: "Start a decision thread" },
  { name: "check-in", hint: "Run a check-in", holdingHint: "Run the due check-ins" },
  { name: "market", hint: "Run a market check", projectOnly: true },
  { name: "thread", arg: "title", hint: "Move your last message into its own thread" },
];

export const commandHint = (c: Command, scope: string) => (scope === "holding" && c.holdingHint) || c.hint;

export function parseCommand(text: string): { name: string; arg: string } | undefined {
  const m = text.trim().match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/);
  if (!m || !commands.some((c) => c.name === m[1])) return undefined;
  return { name: m[1], arg: (m[2] || "").trim() };
}

// Commands matching what's typed so far ("/de" → decide), while the first word is still being written.
export function matchCommands(text: string, scope: string): Command[] {
  const m = text.match(/^\/([a-z-]*)$/);
  if (!m) return [];
  return commands.filter((c) => c.name.startsWith(m[1]) && !(c.projectOnly && scope === "holding"));
}
