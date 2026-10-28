"use server";
import { saveUploads } from "@/lib/attachments";
import { openLocal } from "@/lib/local-files";

export async function openFile(scope: string, file: string): Promise<{ ok?: string; error?: string }> {
  try {
    return await openLocal(String(scope).slice(0, 200), String(file).slice(0, 400));
  } catch {
    return { error: "Couldn't open it." };
  }
}

// A file pasted, dropped or picked in a message field is saved at once (holding/uploads/<date>/), so the field keeps
// only its path: the chip survives a reload in the draft, and the send attaches it like any other path.
export async function uploadFiles(form: FormData): Promise<{ paths?: string[]; error?: string }> {
  try {
    return { paths: await saveUploads(form.getAll("files").filter((f): f is File => f instanceof File)) };
  } catch (error) {
    return { error: (error as Error).message || "Couldn't save the file." };
  }
}
