// @effect-diagnostics nodeBuiltinImport:off - Writes startup files into the throwaway home.

import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { ServerEnv } from "./server.ts";

/** The only git config fixtures and servers read; see the file. */
export const SCENARIO_GITCONFIG = NodeURL.fileURLToPath(new URL("./gitconfig", import.meta.url));

/** Git without the developer's global or system config. */
export const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: SCENARIO_GITCONFIG,
  GIT_CONFIG_NOSYSTEM: "1",
});

/** The shell scenarios run, whatever the developer's `SHELL`: zsh, else bash (both wrapped by Probe). */
export function scenarioShell(pathEnv = process.env.PATH ?? ""): string {
  for (const name of ["zsh", "bash"]) {
    for (const dir of pathEnv.split(NodePath.delimiter)) {
      if (dir === "") continue;
      const candidate = NodePath.join(dir, name);
      try {
        NodeFS.accessSync(candidate, NodeFS.constants.X_OK);
        return candidate;
      } catch {
        // Not in this directory.
      }
    }
  }
  throw new Error("Scenarios need zsh or bash on PATH.");
}

// A fixed prompt with no theme, so the prompt's width and timing are the same on every machine.
const RC = `PS1='$ '
HISTFILE="$HOME/.shell_history"
`;
const ZSHRC = `${RC}RPROMPT=''
`;

/**
 * Makes `<home>/shell-home` with plain startup files and returns the variables that point the
 * server and its shells at it. The folder goes with the throwaway home.
 */
export async function isolatedShellEnv(home: string): Promise<ServerEnv> {
  const shellHome = NodePath.join(home, "shell-home");
  await NodeFSP.mkdir(shellHome, { recursive: true });
  await Promise.all([
    NodeFSP.writeFile(NodePath.join(shellHome, ".zshenv"), ""),
    NodeFSP.writeFile(NodePath.join(shellHome, ".zprofile"), ""),
    NodeFSP.writeFile(NodePath.join(shellHome, ".zshrc"), ZSHRC),
    NodeFSP.writeFile(NodePath.join(shellHome, ".bashrc"), RC),
    NodeFSP.writeFile(NodePath.join(shellHome, ".bash_profile"), ""),
  ]);
  return {
    HOME: shellHome,
    SHELL: scenarioShell(),
    ZDOTDIR: undefined,
    XDG_CONFIG_HOME: undefined,
    BASH_ENV: undefined,
    ENV: undefined,
    PROMPT_COMMAND: undefined,
    PS1: undefined,
  };
}
