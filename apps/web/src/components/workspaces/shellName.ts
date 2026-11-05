import type { ShellSummary } from "@t3tools/contracts";

/** The last segment of a folder path, which is how folders are named in the tree and tabs. */
export const folderName = (path: string) =>
  path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;

/**
 * "Shell 2 · repo · node": the fixed workspace number, the folder when asked for, and the program
 * running in the shell right now. A shell started outside a workspace has no number and keeps
 * the terminal's own label, which already names its program.
 */
export function shellName(shell: ShellSummary, options: { readonly folder: boolean }): string {
  if (shell.title === null) {
    return options.folder ? `${shell.label} · ${folderName(shell.cwd)}` : shell.label;
  }
  return [shell.title, options.folder ? folderName(shell.cwd) : null, shell.process]
    .filter((part) => part !== null)
    .join(" · ");
}
