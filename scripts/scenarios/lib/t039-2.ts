import { expected } from "./expect.ts";
import { gitOk } from "./files.ts";
import type { FolderResult, Setup } from "./setup.ts";

/** A folder with `git init` and no commit, as a user's new repository is. */
export async function uncommittedRepo(setup: Setup, label = "repo"): Promise<FolderResult> {
  const made = await setup.folder(label);
  await gitOk(made.path, "init", "-q");
  return made;
}

/** Fails unless `found` holds `part` (starts with it with `atStart`), naming the text found. */
export function expectText(
  what: string,
  found: string | null,
  part: string,
  { atStart = false }: { readonly atStart?: boolean } = {},
) {
  const want = `text ${atStart ? "starting with" : "containing"} "${part}"`;
  const holds = found !== null && (atStart ? found.startsWith(part) : found.includes(part));
  expected({ what, expected: want, found: holds ? want : (found ?? "no text") });
}
