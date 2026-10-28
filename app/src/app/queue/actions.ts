"use server";
import { revalidatePath } from "next/cache";
import { saveQuestion } from "@/lib/files";
import { getCompanies, repoRoot } from "@/lib/repository";
export type QueueState = { error?: string; saved?: string };
export async function addQuestion(
  _previous: QueueState,
  form: FormData,
): Promise<QueueState> {
  const title = String(form.get("title") || ""),
    question = String(form.get("question") || ""),
    project = String(form.get("project") || "");
  try {
    const saved = await saveQuestion(
      repoRoot,
      { title, question, project },
      (await getCompanies()).map((c) => c.id),
    );
    revalidatePath("/", "layout");
    return { saved };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/^(Give the question|Add a question|Choose an existing)/.test(message))
      return { error: message };
    console.error("Unable to save queue question", error);
    return {
      error:
        "Couldn’t save the question",
    };
  }
}
