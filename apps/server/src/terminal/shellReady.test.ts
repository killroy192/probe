// @effect-diagnostics nodeBuiltinImport:off - Asks whether a shell program is installed.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  makeReadyScanner,
  makeStartReportScanner,
  START_PROGRAM_ENV,
  shellReadyLaunch,
  waitForPromptMark,
  writeShellReadyFiles,
  type ShellOutputEvent,
} from "./shellReady.ts";

const MARK = "\u001b]133;B\u0007";
/** Prompt start with Kitty's `redraw=1`: the terminal may clear the prompt on resize. */
const PROMPT_MARK = "\u001b]133;A;redraw=1\u0007";

/** Feeds `chunks` to a fresh scanner and returns the chunk indexes that completed a mark. */
const hits = (chunks: ReadonlyArray<string>) => {
  const scanner = makeReadyScanner();
  return chunks.flatMap((chunk, index) => (scanner.feed(chunk) ? [index] : []));
};

describe("ready scanner", () => {
  it("finds the input-start mark, alone or after a prompt", () => {
    assert.deepStrictEqual(hits([MARK]), [0]);
    assert.deepStrictEqual(hits([`banner\r\nvscode $ ${MARK}`]), [0]);
    assert.deepStrictEqual(hits(["\u001b]133;B\u001b\\"]), [0]);
  });

  it("finds a mark split at any byte boundary", () => {
    // The mark's prefix is its first 7 characters; a cut after them leaves only the terminator.
    for (let cut = 1; cut < 7; cut += 1) {
      assert.deepStrictEqual(hits([MARK.slice(0, cut), MARK.slice(cut)]), [1], `cut at ${cut}`);
    }
    assert.deepStrictEqual(hits(["\u001b", "]", "1", "3", "3", ";", "B"]), [6]);
  });

  it("ignores the prompt-start mark, which a shell prints before the prompt is read", () => {
    assert.deepStrictEqual(hits(["\u001b]133;A\u0007"]), []);
    assert.deepStrictEqual(hits(["\u001b]133;A;redraw=1\u0007vscode $ "]), []);
  });

  it("ignores output that only looks like the mark", () => {
    assert.deepStrictEqual(hits(["\u001b]133;C\u0007"]), []);
    assert.deepStrictEqual(hits(["\u001b]13;B\u0007"]), []);
    assert.deepStrictEqual(hits(["133;B"]), []);
    assert.deepStrictEqual(hits(["\u001b]133", "plain text", ";B"]), []);
    assert.deepStrictEqual(hits(["\u001b[?2004h", "\u001b]7;file://host/tmp\u001b\\"]), []);
  });

  it("recovers from a broken start and finds the next mark", () => {
    assert.deepStrictEqual(hits(["\u001b]133;\u001b]133;B\u0007"]), [0]);
    assert.deepStrictEqual(hits(["\u001b\u001b]133;B"]), [0]);
  });
});

describe("start program report", () => {
  const read = (chunks: ReadonlyArray<string>) => {
    const scanner = makeStartReportScanner();
    for (const chunk of chunks) scanner.feed(chunk);
    return scanner.report();
  };

  it("reads found or missing, also split across chunks, and ignores anything else", () => {
    assert.strictEqual(read(["\u001b]6973;start;found\u0007"]), "found");
    assert.strictEqual(read(["x\u001b]69", "73;start;mis", "sing\u0007"]), "missing");
    assert.strictEqual(read(["\u001b]6973;start;maybe\u0007"]), null);
    assert.strictEqual(read(["\u001b]6973;start;found"]), null);
    assert.strictEqual(read(["\u001b]133;B\u0007"]), null);
  });
});

describe("waiting for the prompt mark", () => {
  const start = () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ShellOutputEvent>();
      const waiting = yield* waitForPromptMark(Stream.fromQueue(events), "15 seconds").pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      return { events, waiting };
    });
  const output = (data: string): ShellOutputEvent => ({ type: "output", data });

  it.effect("ends with the mark and not before, even when it arrives in pieces", () =>
    Effect.gen(function* () {
      const { events, waiting } = yield* start();
      yield* Queue.offer(events, output("noise\r\n\u001b]13"));
      assert.isUndefined(waiting.pollUnsafe());
      yield* Queue.offer(events, output("3;B\u0007"));
      assert.deepStrictEqual(yield* Fiber.join(waiting), { outcome: "mark", program: null });
    }),
  );

  it.effect("gives up when the timeout passes without the mark", () =>
    Effect.gen(function* () {
      const { events, waiting } = yield* start();
      yield* Queue.offer(events, output("no mark here"));
      yield* TestClock.adjust("14 seconds");
      assert.isUndefined(waiting.pollUnsafe());
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(yield* Fiber.join(waiting), { outcome: "timeout", program: null });
    }),
  );

  it.effect("stops when the shell ends first", () =>
    Effect.gen(function* () {
      const { events, waiting } = yield* start();
      yield* Queue.offer(events, { type: "exited" });
      assert.deepStrictEqual(yield* Fiber.join(waiting), { outcome: "exited", program: null });
    }),
  );

  it.effect("carries the start program report printed before the mark", () =>
    Effect.gen(function* () {
      const { events, waiting } = yield* start();
      yield* Queue.offer(events, output("\u001b]6973;start;missing\u0007prompt\u001b]133;B\u0007"));
      assert.deepStrictEqual(yield* Fiber.join(waiting), { outcome: "mark", program: "missing" });
    }),
  );
});

describe("shell ready launch", () => {
  const launch = (
    shell: string,
    env: NodeJS.ProcessEnv = {},
    platform: NodeJS.Platform = "linux",
  ) => shellReadyLaunch({ shell, platform, dir: "/state/shell-ready", env });

  it("sends zsh through a wrapper startup folder that remembers the user's own", () => {
    assert.deepStrictEqual(launch("/usr/bin/zsh"), {
      args: [],
      env: { ZDOTDIR: "/state/shell-ready/zsh", PROBE_ORIG_ZDOTDIR: "" },
    });
    assert.deepStrictEqual(launch("zsh", { ZDOTDIR: "/home/me/.config/zsh" }), {
      args: [],
      env: { ZDOTDIR: "/state/shell-ready/zsh", PROBE_ORIG_ZDOTDIR: "/home/me/.config/zsh" },
    });
  });

  it("sends bash through a wrapper rc file", () => {
    assert.deepStrictEqual(launch("/bin/bash"), {
      args: ["--rcfile", "/state/shell-ready/bashrc"],
      env: {},
    });
  });

  it("leaves every other shell, and Windows, alone", () => {
    for (const shell of ["/bin/sh", "/usr/bin/dash", "/usr/bin/fish", "/bin/zshell", "pwsh"]) {
      assert.strictEqual(launch(shell), null, shell);
    }
    assert.strictEqual(launch("C:\\tools\\zsh.exe", {}, "win32"), null);
    assert.strictEqual(launch("bash", {}, "win32"), null);
  });
});

/** Runs `shell` under a pty with the wrapper, types `line` at the mark, and returns what it printed. */
const runUnderWrapper = (
  shell: "zsh" | "bash",
  home: string,
  extraEnv: Record<string, string>,
  /** Typed at the mark without Enter, then the pty narrows; the result waits for the redraw. */
  typedBeforeResize?: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "probe-shell-ready-" });
    yield* writeShellReadyFiles(dir);
    const { ZDOTDIR: _ambient, ...inherited } = process.env;
    const env: NodeJS.ProcessEnv = {
      ...inherited,
      HOME: home,
      TERM: "xterm-256color",
      ...extraEnv,
    };
    const plan = shellReadyLaunch({ shell, platform: "linux", dir, env });
    assert.isNotNull(plan);
    const pty = yield* Effect.promise(() => import("node-pty"));
    let seen = "";
    return yield* Effect.promise(
      (signal) =>
        new Promise<{
          readonly output: string;
          readonly markAt: number;
          readonly resizedAt: number;
        }>((resolve) => {
          const proc = pty.spawn(shell, [...plan!.args], {
            name: "xterm-256color",
            cols: 100,
            rows: 30,
            cwd: path.resolve(home),
            env: { ...env, ...plan!.env } as Record<string, string>,
          });
          signal.addEventListener("abort", () => proc.kill());
          const scanner = makeReadyScanner();
          let output = "";
          let markAt = -1;
          let resizedAt = -1;
          const report = () =>
            proc.write(
              `printf 'RESULT[%s][%s][%s]\\n' "$PROBE_TEST_USER_RC" "\${ZDOTDIR-unset}" "$(printenv ${START_PROGRAM_ENV} || echo none)"\r`,
            );
          proc.onData((data) => {
            output += data;
            seen = output;
            if (markAt < 0 && scanner.feed(data)) {
              markAt = output.length;
              if (typedBeforeResize === undefined) report();
              else proc.write(typedBeforeResize);
            }
            if (typedBeforeResize !== undefined && markAt >= 0) {
              if (resizedAt < 0 && output.endsWith(typedBeforeResize)) {
                resizedAt = output.length;
                proc.resize(40, 30);
              } else if (resizedAt >= 0 && output.slice(resizedAt).endsWith(typedBeforeResize)) {
                // The redraw is in; clear the typed line so the report runs alone.
                typedBeforeResize = undefined;
                proc.write("\u0015");
                report();
              }
            }
            if (markAt >= 0 && /RESULT\[(?!%s)[^\]]*\]\[[^\]]*\]/.test(output)) {
              proc.kill();
              resolve({ output, markAt, resizedAt });
            }
          });
        }),
    ).pipe(
      // A shell that never prints the mark fails here with its output, instead of hanging.
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () =>
          Effect.die(new Error(`no ready mark; the shell printed ${JSON.stringify(seen)}`)),
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** A command line typed at the mark, as a starting script is, runs once, after the mark (A-1). */
const assertRanOnceAfterMark = (result: { readonly output: string; readonly markAt: number }) => {
  const runs = [...result.output.matchAll(/RESULT\[rc\]\[unset\]/g)];
  assert.lengthOf(runs, 1);
  assert.isAbove(runs[0]!.index, result.markAt);
};

// These run the real shell; where it is not installed they show as skipped, not as passed.
const installed = (shell: string) => NodeChildProcess.spawnSync(shell, ["--version"]).status === 0;
const zsh = it.live.skipIf(!installed("zsh"));
const bash = it.live.skipIf(!installed("bash"));

describe("shell ready wrapper in a real shell", () => {
  zsh(
    "zsh runs the user's files, restores ZDOTDIR and prints the mark before the first prompt line is read",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
        const custom = `${home}/custom-zsh`;
        yield* fs.makeDirectory(custom);
        yield* fs.writeFileString(`${custom}/.zshenv`, "export PROBE_TEST_USER_RC=env\n");
        yield* fs.writeFileString(
          `${custom}/.zshrc`,
          "PROBE_TEST_USER_RC=${PROBE_TEST_USER_RC}+rc\n",
        );
        const result = yield* runUnderWrapper("zsh", home, { ZDOTDIR: custom });
        assert.isAbove(result.markAt, 0);
        // The user's .zshenv and .zshrc both ran, and ZDOTDIR is the user's again for the session.
        assert.include(result.output, `RESULT[env+rc][${custom}]`);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  zsh("zsh marks prompt start before its prompt and input start after it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
      // A theme that sets its prompt from precmd, after the wrapper's files were read.
      yield* fs.writeFileString(
        `${home}/.zshrc`,
        "export PROBE_TEST_USER_RC=rc\nprobe_theme() { PS1='zp> ' }\nprecmd_functions+=(probe_theme)\n",
      );
      const result = yield* runUnderWrapper("zsh", home, {}, "echo typed");
      const first = result.output.slice(0, result.markAt);
      const promptAt = first.lastIndexOf("zp> ");
      assert.isAbove(promptAt, 0);
      // Ghostty starts a fresh line at a prompt-start mark, so one after the prompt splits the line.
      assert.notInclude(first.slice(promptAt), "\u001b]133;A");
      assert.include(first.slice(promptAt), MARK, "input starts after the prompt");
      // The prompt-start mark leads the prompt, and the redraw after the resize prints it again.
      assert.isTrue(first.slice(0, promptAt).endsWith(PROMPT_MARK), "mark right before the prompt");
      const redraw = result.output.slice(result.resizedAt);
      assert.isAbove(redraw.indexOf("zp> "), redraw.indexOf(PROMPT_MARK));
      assert.isAtLeast(redraw.indexOf(PROMPT_MARK), 0);
      assert.include(result.output, "RESULT[rc][unset]");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  zsh("zsh without a ZDOTDIR leaves it unset", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
      yield* fs.writeFileString(`${home}/.zshrc`, "export PROBE_TEST_USER_RC=rc\n");
      const result = yield* runUnderWrapper("zsh", home, {});
      assert.include(result.output, "RESULT[rc][unset]");
      assertRanOnceAfterMark(result);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // Prompt themes (starship, oh-my-bash) rebuild PS1 from PROMPT_COMMAND before every prompt.
  for (const [setup, rc] of [
    ["a fixed PS1", "PS1='bp> '"],
    ["PS1 rebuilt by a PROMPT_COMMAND string", "PROMPT_COMMAND='PS1=\"bp> \"'"],
    ["PS1 rebuilt by a PROMPT_COMMAND array", "PROMPT_COMMAND=('PS1=\"bp> \"')"],
  ] as const) {
    bash(`bash marks prompt start before its prompt and input start after it, with ${setup}`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
        yield* fs.writeFileString(`${home}/.bashrc`, `export PROBE_TEST_USER_RC=rc\n${rc}\n`);
        const result = yield* runUnderWrapper("bash", home, {}, "echo typed");
        const first = result.output.slice(0, result.markAt);
        const promptAt = first.lastIndexOf("bp> ");
        assert.isAbove(promptAt, 0);
        assert.notInclude(first.slice(promptAt), "\u001b]133;A");
        assert.include(first.slice(promptAt), MARK, "input starts after the prompt");
        // The prompt-start mark leads the prompt, and the redraw after the resize prints it again.
        assert.isTrue(
          first.slice(0, promptAt).endsWith(PROMPT_MARK),
          "mark right before the prompt",
        );
        const redraw = result.output.slice(result.resizedAt);
        assert.isAbove(redraw.indexOf("bp> "), redraw.indexOf(PROMPT_MARK));
        assert.isAtLeast(redraw.indexOf(PROMPT_MARK), 0);
        assert.include(result.output, "RESULT[rc][unset]");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  bash("bash runs the user's .bashrc and prints the mark", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
      yield* fs.writeFileString(`${home}/.bashrc`, "export PROBE_TEST_USER_RC=rc\n");
      const result = yield* runUnderWrapper("bash", home, {});
      assert.isAbove(result.markAt, 0);
      assert.include(result.output, "RESULT[rc][unset]");
      assertRanOnceAfterMark(result);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  // U-1 (PRB.T-016): the shell, after its startup files, decides what it can run (PRB.T-017 AC-6 to AC-8).
  const startCases = [
    ["a program only on a PATH the rc file adds", "rc-tool", "found"],
    ["an alias from the rc file", "probe-alias", "found"],
    ["a function from the rc file", "probe_fn", "found"],
    ["a builtin", "export", "found"],
    ["an executable path in the cwd", "./bin/local-tool", "found"],
    ["a missing path in the cwd", "./bin/absent", "missing"],
    ["a name nothing defines", "no-such-program-probe", "missing"],
  ] as const;
  const startHome = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
    for (const file of [`${home}/rcbin/rc-tool`, `${home}/bin/local-tool`]) {
      yield* fs.makeDirectory(file.replace(/\/[^/]*$/, ""), { recursive: true });
      yield* fs.writeFileString(file, "#!/bin/sh\n");
      yield* fs.chmod(file, 0o755);
    }
    const rc = `export PROBE_TEST_USER_RC=rc\nPATH="$HOME/rcbin:$PATH"\nalias probe-alias=true\nprobe_fn() { :; }\n`;
    yield* fs.writeFileString(`${home}/.zshrc`, rc);
    yield* fs.writeFileString(`${home}/.bashrc`, rc);
    return home;
  });
  const assertStartReports = (shell: "zsh" | "bash") =>
    Effect.gen(function* () {
      const home = yield* startHome;
      for (const [what, program, expected] of startCases) {
        const result = yield* runUnderWrapper(shell, home, { [START_PROGRAM_ENV]: program });
        const reports = [...result.output.matchAll(/\u001b\]6973;start;(\w+)\u0007/g)];
        assert.deepStrictEqual(
          reports.map((match) => match[1]),
          [expected],
          what,
        );
        assert.isBelow(reports[0]!.index, result.markAt, what);
        // The program is not left in the environment of what the shell runs.
        const ran = result.output.indexOf("RESULT[rc][unset][none]");
        assert.isAbove(ran, result.markAt, what);
        // The typed command's output follows a command-start mark, so a resize keeps it.
        const commandStart = result.output.indexOf("\u001b]133;C", result.markAt);
        assert.isTrue(commandStart >= 0 && commandStart < ran, `${what}: no command-start mark`);
      }
      const plain = yield* runUnderWrapper(shell, home, {});
      assert.notInclude(plain.output, "\u001b]6973;");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
  zsh("zsh reports once, before the first mark, whether it can run the start program", () =>
    assertStartReports("zsh"),
  );
  bash("bash reports once, before the first mark, whether it can run the start program", () =>
    assertStartReports("bash"),
  );
});
