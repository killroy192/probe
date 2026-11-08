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
  shellReadyLaunch,
  waitForPromptMark,
  writeShellReadyFiles,
  type ShellOutputEvent,
} from "./shellReady.ts";

const MARK = "\u001b]133;A\u0007";
const INPUT_MARK = "\u001b]133;B\u0007";

/** Feeds `chunks` to a fresh scanner and returns the chunk indexes that completed a mark. */
const hits = (chunks: ReadonlyArray<string>) => {
  const scanner = makeReadyScanner();
  return chunks.flatMap((chunk, index) => (scanner.feed(chunk) ? [index] : []));
};

describe("ready scanner", () => {
  it("finds the prompt-start mark, alone or among other output", () => {
    assert.deepStrictEqual(hits([MARK]), [0]);
    assert.deepStrictEqual(hits([`banner\r\n${MARK}vscode $ `]), [0]);
    assert.deepStrictEqual(hits(["\u001b]133;A\u001b\\"]), [0]);
    // Parameters after the A, as some prompts add them, still count.
    assert.deepStrictEqual(hits(["\u001b]133;A;cl=m;aid=1\u0007"]), [0]);
  });

  it("finds the input-start mark, alone, after a prompt, or split", () => {
    assert.deepStrictEqual(hits([INPUT_MARK]), [0]);
    assert.deepStrictEqual(hits([`vscode $ ${INPUT_MARK}`]), [0]);
    for (let cut = 1; cut < 7; cut += 1) {
      assert.deepStrictEqual(
        hits([INPUT_MARK.slice(0, cut), INPUT_MARK.slice(cut)]),
        [1],
        `cut at ${cut}`,
      );
    }
  });

  it("finds a mark split at any byte boundary", () => {
    // The mark's prefix is its first 7 characters; a cut after them leaves only the terminator.
    for (let cut = 1; cut < 7; cut += 1) {
      assert.deepStrictEqual(hits([MARK.slice(0, cut), MARK.slice(cut)]), [1], `cut at ${cut}`);
    }
    assert.deepStrictEqual(hits(["\u001b", "]", "1", "3", "3", ";", "A"]), [6]);
  });

  it("ignores output that only looks like the mark", () => {
    assert.deepStrictEqual(hits(["\u001b]133;C\u0007"]), []);
    assert.deepStrictEqual(hits(["\u001b]13;A\u0007"]), []);
    assert.deepStrictEqual(hits(["133;A"]), []);
    assert.deepStrictEqual(hits(["\u001b]133", "plain text", ";A"]), []);
    assert.deepStrictEqual(hits(["\u001b[?2004h", "\u001b]7;file://host/tmp\u001b\\"]), []);
  });

  it("recovers from a broken start and finds the next mark", () => {
    assert.deepStrictEqual(hits(["\u001b]133;\u001b]133;A\u0007"]), [0]);
    assert.deepStrictEqual(hits(["\u001b\u001b]133;A"]), [0]);
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
      yield* Queue.offer(events, output("3;A\u0007"));
      assert.strictEqual(yield* Fiber.join(waiting), "mark");
    }),
  );

  it.effect("gives up when the timeout passes without the mark", () =>
    Effect.gen(function* () {
      const { events, waiting } = yield* start();
      yield* Queue.offer(events, output("no mark here"));
      yield* TestClock.adjust("14 seconds");
      assert.isUndefined(waiting.pollUnsafe());
      yield* TestClock.adjust("1 second");
      assert.strictEqual(yield* Fiber.join(waiting), "timeout");
    }),
  );

  it.effect("stops when the shell ends first", () =>
    Effect.gen(function* () {
      const { events, waiting } = yield* start();
      yield* Queue.offer(events, { type: "exited" });
      assert.strictEqual(yield* Fiber.join(waiting), "exited");
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
const runUnderWrapper = (shell: "zsh" | "bash", home: string, extraEnv: Record<string, string>) =>
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
    return yield* Effect.promise(
      () =>
        new Promise<{ readonly output: string; readonly markAt: number }>((resolve) => {
          const proc = pty.spawn(shell, [...plan!.args], {
            name: "xterm-256color",
            cols: 100,
            rows: 30,
            cwd: path.resolve(home),
            env: { ...env, ...plan!.env } as Record<string, string>,
          });
          const scanner = makeReadyScanner();
          let output = "";
          let markAt = -1;
          proc.onData((data) => {
            output += data;
            if (markAt < 0 && scanner.feed(data)) {
              markAt = output.length;
              proc.write('printf \'RESULT[%s][%s]\\n\' "$PROBE_TEST_USER_RC" "${ZDOTDIR-unset}"\r');
            }
            if (markAt >= 0 && /RESULT\[(?!%s)[^\]]*\]\[[^\]]*\]/.test(output)) {
              proc.kill();
              resolve({ output, markAt });
            }
          });
        }),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

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

  zsh("zsh without a ZDOTDIR leaves it unset", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
      yield* fs.writeFileString(`${home}/.zshrc`, "export PROBE_TEST_USER_RC=rc\n");
      const result = yield* runUnderWrapper("zsh", home, {});
      assert.include(result.output, "RESULT[rc][unset]");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  bash("bash runs the user's .bashrc and prints the mark", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "probe-home-" });
      yield* fs.writeFileString(`${home}/.bashrc`, "export PROBE_TEST_USER_RC=rc\n");
      const result = yield* runUnderWrapper("bash", home, {});
      assert.isAbove(result.markAt, 0);
      assert.include(result.output, "RESULT[rc][unset]");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
