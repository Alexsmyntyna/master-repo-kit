import matter from "gray-matter";

// gray-matter runs `---js` / `---javascript` / `---coffee` front matter as code. Agents write the Markdown this app
// reads, so only YAML and JSON are parsed; any other engine is refused.
const refuse = () => {
  throw new Error("Only YAML or JSON front matter is read");
};
const options = { engines: { js: refuse, javascript: refuse, coffee: refuse, coffeescript: refuse } };

export function frontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const lang = raw.match(/^---[ \t]*([A-Za-z]+)?/)?.[1]?.toLowerCase();
  if (lang && lang !== "yaml" && lang !== "yml" && lang !== "json") return { data: {}, content: raw };
  try {
    const parsed = matter(raw, options as Parameters<typeof matter>[1]);
    return { data: parsed.data, content: parsed.content };
  } catch {
    return { data: {}, content: raw };
  }
}
