import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

/**
 * What a shell prints once its line editor reads input: OSC 133;B, the FinalTerm input-start mark.
 * The prompt-start mark (A) comes before the prompt, too early to type into.
 */
const INPUT_START = "\u001b]133;B";

export interface ReadyScanner {
  /** Whether this chunk completes the mark; a mark may be split across chunks. */
  readonly feed: (chunk: string) => boolean;
}

/** Finds the first input-start mark in a shell's output; it matches the prefix, so parameters may follow. */
export function makeReadyScanner(): ReadyScanner {
  let matched = 0;
  return {
    feed: (chunk) => {
      for (const char of chunk) {
        if (char === INPUT_START[matched]) {
          matched += 1;
          if (matched === INPUT_START.length) {
            matched = 0;
            return true;
          }
        } else {
          // An ESC always starts a new attempt; anything else cannot be part of one.
          matched = char === INPUT_START[0] ? 1 : 0;
        }
      }
      return false;
    },
  };
}

/**
 * The env var that names the program a starting script runs. The wrapper takes it out of the
 * environment first and looks it up at the first prompt, after the startup files ran.
 */
export const START_PROGRAM_ENV = "PROBE_START_PROGRAM";

// A private OSC the wrapper prints once, before the first input-start mark: whether the shell can
// run the start program. 6973 is unassigned; terminals ignore an OSC they do not know.
const START_REPORT = "\u001b]6973;start;";

export type StartProgramReport = "found" | "missing";

/** Finds the wrapper's report on the start program; the report may be split across chunks. */
export function makeStartReportScanner() {
  let matched = 0;
  let value: string | null = null;
  let report: StartProgramReport | null = null;
  return {
    feed: (chunk: string) => {
      for (const char of chunk) {
        if (report !== null) return;
        if (value !== null) {
          if (char === "\u0007" || char === "\u001b") {
            if (value === "found" || value === "missing") report = value;
            value = null;
          } else if (value.length < 8) value += char;
          else value = null;
        } else if (char === START_REPORT[matched]) {
          matched += 1;
          if (matched === START_REPORT.length) {
            matched = 0;
            value = "";
          }
        } else {
          matched = char === START_REPORT[0] ? 1 : 0;
        }
      }
    },
    report: () => report,
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
// A resize with `redraw=1` clears the prompt rows, so the command-start mark C must end them.
const ZSH_FILES = {
  ".zshenv": `__probe_dir="$ZDOTDIR"
if (( \${+${START_PROGRAM_ENV}} )); then
  __probe_start_program="$${START_PROGRAM_ENV}"
  unset ${START_PROGRAM_ENV}
fi
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
__probe_prompt_mark=$'%{\\e]133;A;redraw=1\\a%}'
__probe_mark_prompt() { [[ "$PS1" == "$__probe_prompt_mark"* ]] || PS1="$__probe_prompt_mark$PS1" }
precmd_functions+=(__probe_mark_prompt)
__probe_command_start() { printf '\\033]133;C\\a' }
preexec_functions+=(__probe_command_start)
__probe_ready() {
  if (( \${+__probe_start_program} )); then
    if whence -w -- "$__probe_start_program" >/dev/null 2>&1; then
      printf '\\033]6973;start;found\\a'
    else
      printf '\\033]6973;start;missing\\a'
    fi
    unset __probe_start_program
  fi
  printf '\\033]133;B\\a'
}
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
// PS1. A PROMPT_COMMAND runs before that point and would let typed input be echoed twice. The hook
// runs after the user's PROMPT_COMMAND, which prompt themes use to rebuild PS1 before every prompt,
// and adds the marks again when they are gone. PS0 (bash 4.4 and later) prints the command start.
const BASHRC = `if [ -n "\${${START_PROGRAM_ENV}+x}" ]; then
  __probe_start_program="$${START_PROGRAM_ENV}"
  unset ${START_PROGRAM_ENV}
fi
[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__probe_ready() {
  if [ -n "\${__probe_start_program+x}" ]; then
    if type -t -- "$__probe_start_program" >/dev/null 2>&1; then
      printf '\\033]6973;start;found\\a'
    else
      printf '\\033]6973;start;missing\\a'
    fi
    unset __probe_start_program
  fi
  case "$PS1" in *'133;A'*) ;; *) PS1="\\[\\033]133;A;redraw=1\\a\\]\${PS1}" ;; esac
  case "$PS1" in *'133;B'*) ;; *) PS1="\${PS1}\\[\\033]133;B\\a\\]" ;; esac
  case "$PS0" in *'133;C'*) ;; *) PS0="\${PS0}\\033]133;C\\a" ;; esac
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND+=(__probe_ready)
else
  PROMPT_COMMAND="\${PROMPT_COMMAND:+$PROMPT_COMMAND;}__probe_ready"
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
 * Waits for the shell's first prompt mark, and reads the start program report printed before it
 * (null when there was none). The shell may end first, and a shell that never prints the mark (a
 * startup file that replaced the wrapper, or a very slow one) ends the wait on `timeout`.
 */
export const waitForPromptMark = Effect.fn("shellReady.waitForPromptMark")(function* (
  events: Stream.Stream<ShellOutputEvent>,
  timeout: Duration.Input,
) {
  const scanner = makeReadyScanner();
  const reports = makeStartReportScanner();
  const found = yield* events.pipe(
    Stream.map((event) => {
      if (event.type === "exited") return "exited";
      reports.feed(event.data);
      return scanner.feed(event.data) ? "mark" : null;
    }),
    Stream.filter((outcome) => outcome !== null),
    Stream.take(1),
    Stream.runHead,
    Effect.timeoutOption(timeout),
  );
  const outcome = Option.isNone(found)
    ? "timeout"
    : Option.getOrElse(found.value, () => "exited" as const);
  return { outcome, program: outcome === "mark" ? reports.report() : null };
});
