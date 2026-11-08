import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

/** The FinalTerm semantic-prompt marks, OSC 133, up to the letter that names the mark. */
const SEMANTIC_PROMPT = "\u001b]133;";
/** Marks that mean the shell is ready: A (prompt start) and B (input start). */
const READY_MARKS = new Set(["A", "B"]);

export interface ReadyScanner {
  /** Whether this chunk completes the mark; a mark may be split across chunks. */
  readonly feed: (chunk: string) => boolean;
}

/** Finds the first ready mark in a shell's output; it matches the prefix, so parameters may follow. */
export function makeReadyScanner(): ReadyScanner {
  let matched = 0;
  return {
    feed: (chunk) => {
      for (const char of chunk) {
        if (matched === SEMANTIC_PROMPT.length) {
          matched = 0;
          if (READY_MARKS.has(char)) return true;
        }
        if (char === SEMANTIC_PROMPT[matched]) {
          matched += 1;
        } else {
          // An ESC always starts a new attempt; anything else cannot be part of one.
          matched = char === SEMANTIC_PROMPT[0] ? 1 : 0;
        }
      }
      return false;
    },
  };
}

export interface ShellReadyLaunch {
  /** Goes before the shell's own arguments. */
  readonly args: ReadonlyArray<string>;
  /** Goes on top of the shell's environment. */
  readonly env: Readonly<Record<string, string>>;
}

const programName = (shell: string) => shell.split("/").at(-1) ?? shell;

/**
 * How to start `shell` so it prints the prompt mark, or null for a shell that cannot (it then
 * starts as it is). The wrapper files, written by `writeShellReadyFiles` into `dir`, run the user's
 * own startup files first.
 */
export function shellReadyLaunch(input: {
  readonly shell: string;
  readonly platform: NodeJS.Platform;
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
}): ShellReadyLaunch | null {
  if (input.platform === "win32") return null;
  switch (programName(input.shell)) {
    case "zsh":
      return {
        args: [],
        env: { ZDOTDIR: `${input.dir}/zsh`, PROBE_ORIG_ZDOTDIR: input.env.ZDOTDIR ?? "" },
      };
    case "bash":
      return { args: ["--rcfile", `${input.dir}/bashrc`], env: {} };
    default:
      return null;
  }
}

// Each zsh file runs the user's own with the user's ZDOTDIR, so a file that reads it still works.
// The mark goes out from a line-init hook: zsh has put the terminal in raw mode by then, and a
// precmd hook runs too early, so input typed on seeing it would be echoed before the prompt.
const ZSH_FILES = {
  ".zshenv": `__probe_dir="$ZDOTDIR"
ZDOTDIR="\${PROBE_ORIG_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$__probe_dir"
`,
  ".zprofile": `ZDOTDIR="\${PROBE_ORIG_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
ZDOTDIR="$__probe_dir"
`,
  ".zshrc": `ZDOTDIR="\${PROBE_ORIG_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
__probe_ready() { printf '\\033]133;B\\a' }
if autoload -Uz add-zle-hook-widget 2>/dev/null; then
  add-zle-hook-widget line-init __probe_ready
else
  precmd_functions+=(__probe_ready)
fi
if [[ -n "$PROBE_ORIG_ZDOTDIR" ]]; then ZDOTDIR="$PROBE_ORIG_ZDOTDIR"; else unset ZDOTDIR; fi
unset __probe_dir
`,
  ".zlogin": `[[ -r "\${PROBE_ORIG_ZDOTDIR:-$HOME}/.zlogin" ]] && source "\${PROBE_ORIG_ZDOTDIR:-$HOME}/.zlogin"
`,
} as const;

// bash prints PS1 after readline has put the terminal in raw mode, so the mark rides on the end of
// PS1. A PROMPT_COMMAND runs before that point and would let typed input be echoed twice. The
// user's PROMPT_COMMAND may change PS1 later, so the hook adds the mark again when it is gone.
const BASHRC = `[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__probe_ready() { case "$PS1" in *'133;B'*) ;; *) PS1="\${PS1}\\[\\033]133;B\\a\\]" ;; esac; }
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND+=(__probe_ready)
else
  PROMPT_COMMAND="__probe_ready\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi
`;

/** Writes the wrapper startup files that `shellReadyLaunch` points at into `dir`. */
export const writeShellReadyFiles = Effect.fn("shellReady.writeFiles")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(`${dir}/zsh`, { recursive: true });
  for (const [name, content] of Object.entries(ZSH_FILES)) {
    yield* fs.writeFileString(`${dir}/zsh/${name}`, content);
  }
  yield* fs.writeFileString(`${dir}/bashrc`, BASHRC);
});

/** What `waitForPromptMark` reads from a shell: its output, and the end of its process. */
export type ShellOutputEvent =
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exited" };

/**
 * Waits for the shell's first prompt mark. The shell may end first, and a shell that never prints
 * the mark (a startup file that replaced the wrapper, or a very slow one) ends the wait on `timeout`.
 */
export const waitForPromptMark = Effect.fn("shellReady.waitForPromptMark")(function* (
  events: Stream.Stream<ShellOutputEvent>,
  timeout: Duration.Input,
) {
  const scanner = makeReadyScanner();
  const outcome = yield* events.pipe(
    Stream.map((event) =>
      event.type === "exited" ? "exited" : scanner.feed(event.data) ? "mark" : null,
    ),
    Stream.filter((found) => found !== null),
    Stream.take(1),
    Stream.runHead,
    Effect.timeoutOption(timeout),
  );
  return Option.isNone(outcome) ? "timeout" : Option.getOrElse(outcome.value, () => "exited");
});
