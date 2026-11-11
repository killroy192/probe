// @effect-diagnostics nodeBuiltinImport:off - Fake server processes are plain emitters.

import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, onTestFinished } from "vite-plus/test";

import { exitWatch, runCliOn, type UnexpectedExit } from "./server.ts";

const settled = (promise: Promise<UnexpectedExit>) =>
  Promise.race([promise, Promise.resolve("pending" as const)]);

describe("exitWatch", () => {
  it("ignores ends the harness asked for and ends while starting", async () => {
    const exits = exitWatch();
    const stopped = new NodeEvents.EventEmitter();
    exits.watch(stopped, () => "stopped");
    exits.ready(stopped);
    exits.expect(stopped);
    stopped.emit("close", null, "SIGTERM");
    const starting = new NodeEvents.EventEmitter();
    exits.watch(starting, () => "starting");
    starting.emit("close", 1, null);
    expect(await settled(exits.unexpectedExit())).toBe("pending");
  });

  it("reports the current process ending by itself, after a restart", async () => {
    const exits = exitWatch();
    const first = new NodeEvents.EventEmitter();
    exits.watch(first, () => "first");
    exits.ready(first);
    exits.expect(first);
    first.emit("close", 0, null);
    const second = new NodeEvents.EventEmitter();
    exits.watch(second, () => "second tail");
    exits.ready(second);
    second.emit("close", null, "SIGSEGV");
    expect(await settled(exits.unexpectedExit())).toEqual({
      code: null,
      signal: "SIGSEGV",
      tail: "second tail",
    });
  });
});

describe("runCliOn", () => {
  const scratch = () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-cli-"));
    onTestFinished(() => NodeFS.rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  /** A CLI that does what the server's does to `--base-dir`, after `before` ran on it. */
  const fakeCli = (dir: string, before: string) => {
    const bin = NodePath.join(dir, "cli.mjs");
    NodeFS.writeFileSync(
      bin,
      `import * as fs from "node:fs";
const home = process.argv[process.argv.indexOf("--base-dir") + 1];
${before}
fs.mkdirSync(home + "/userdata", { recursive: true });
fs.writeFileSync(home + "/userdata/ran", "");
console.log("issued");`,
    );
    return bin;
  };
  const harnessHome = (dir: string) => {
    const home = NodePath.join(dir, "home");
    NodeFS.mkdirSync(NodePath.join(home, "harness"), { recursive: true });
    return home;
  };

  it("runs on the harness's home, and leaves no home it made after the home was removed", async () => {
    const dir = scratch();
    const home = harnessHome(dir);
    expect(await runCliOn(fakeCli(dir, ""), home, [], process.env)).toContain("issued");

    const removed = fakeCli(dir, `fs.rmSync(home, { recursive: true, force: true });`);
    await expect(runCliOn(removed, home, [], process.env)).rejects.toThrow(
      `The server's home ${home} was removed while the CLI ran on it.`,
    );
    expect(NodeFS.existsSync(home)).toBe(false);

    await expect(runCliOn(fakeCli(dir, ""), home, [], process.env)).rejects.toThrow(
      `The server's home ${home} is gone; the CLI is not run.`,
    );
    expect(NodeFS.existsSync(home)).toBe(false);
  });
});
