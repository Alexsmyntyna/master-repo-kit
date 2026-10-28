// The models an agent can run on (tools/converse.py MODELS), and the built-in default per role (DEFAULT_MODEL).
// holding/models.json overrides the defaults; read it with readDefaultModels (lib/models-file.ts).
export const MODELS = ["haiku", "sonnet", "opus", "fable"] as const;
export type Model = (typeof MODELS)[number];
export type Role = "ceo" | "coo";
export const DEFAULT_MODEL: Record<Role, Model> = { ceo: "opus", coo: "sonnet" };
export const modelLabel: Record<Model, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", fable: "Fable" };
export const isModel = (m: unknown): m is Model => typeof m === "string" && (MODELS as readonly string[]).includes(m);
