export type Claim = {
  text: string;
  source?: string;
  ref?: string;
  date?: string;
};
export type Company = {
  id: string;
  name: string;
  kind: unknown;
  stage: unknown;
  updated?: string;
  [key: string]: unknown;
};
export type Document = {
  path: string;
  title: string;
  content: string;
  meta: Record<string, unknown>;
};
export function isClaim(value: unknown): value is Claim {
  return (
    !!value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  );
}
export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (isClaim(value)) return value.text;
  return "";
}
export function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function hasValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value).some(hasValue);
  return true;
}
export function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, (s) => s.toUpperCase());
}
export function dateLabel(input?: string | Date | unknown): string {
  // Frontmatter parsers turn bare YAML dates into Date objects.
  const value = input instanceof Date ? input.toISOString().slice(0, 10) : typeof input === "string" ? input : undefined;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not recorded";
  return new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function initials(name: string): string {
  return name.replace(/[^a-zA-Z]/g, "").slice(0, 2);
}
