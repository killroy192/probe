// @effect-diagnostics nodeBuiltinImport:off - Fake server processes are plain emitters.

import * as NodeEvents from "node:events";

import { describe, expect, it } from "vite-plus/test";

import { exitWatch, type UnexpectedExit } from "./server.ts";

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
