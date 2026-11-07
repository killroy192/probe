// @effect-diagnostics nodeBuiltinImport:off - Drives a real host over its socket with real shells.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it } from "vite-plus/test";

import * as Effect from "effect/Effect";

import { HostConnection, type HostPtyProcess, make } from "./client.ts";
import { startShellHost, type RunningShellHost } from "./host.ts";
import { encodeLine, lineReader, shellHostSocketPath } from "./protocol.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const stateDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "shell-host-"));
  cleanups.push(() => NodeFS.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const start = async (dir: string, idleMs?: number) => {
  const host = (await startShellHost({ stateDir: dir, ...(idleMs ? { idleMs } : {}) }))!;
  cleanups.push(host.stop);
  return host;
};

const connect = async (dir: string) => {
  const connection = await HostConnection.connect(shellHostSocketPath(dir));
  cleanups.push(() => connection.close());
  return connection;
};

const spawnSh = (connection: HostConnection, dir: string, script: string) =>
  connection.spawn({
    shell: "/bin/sh",
    args: ["-c", script],
    cwd: dir,
    cols: 80,
    rows: 24,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });

/** Resolves once the shell's output, kept and new, contains `text`. */
const outputContains = (process: HostPtyProcess, kept: string, text: string) =>
  new Promise<void>((resolve) => {
    let seen = kept;
    if (seen.includes(text)) return resolve();
    process.onData((data) => {
      seen += data;
      if (seen.includes(text)) resolve();
    });
  });

const exitOf = (process: HostPtyProcess) =>
  new Promise<{ exitCode: number; signal: number | null }>((resolve) => process.onExit(resolve));

const fifo = (dir: string) => {
  const file = NodePath.join(dir, "input");
  NodeChildProcess.execFileSync("mkfifo", [file]);
  return file;
};

describe("shell host", () => {
  it("keeps a shell and its output while no server is connected", async () => {
    const dir = stateDir();
    await start(dir);
    const input = fifo(dir);
    const first = await connect(dir);
    const shell = await spawnSh(first, dir, `echo ready; cat "${input}"; read line`);
    await outputContains(shell, "", "ready");
    first.close();

    // The shell prints while the server is away; the host keeps it.
    NodeFS.writeFileSync(input, "printed-while-away\n");
    const second = await connect(dir);
    const [taken] = await second.list();
    expect(taken!.session.pid).toBe(shell.pid);
    expect(taken!.process.pid).toBe(shell.pid);
    await outputContains(taken!.process, taken!.session.output, "printed-while-away");
    expect(taken!.session.output).toContain("ready");

    taken!.process.write("done\n");
    expect(await exitOf(taken!.process)).toEqual({ exitCode: 0, signal: null });
  });

  it("remembers how a shell ended while no server was connected, until it is forgotten", async () => {
    const dir = stateDir();
    await start(dir);
    const input = fifo(dir);
    const first = await connect(dir);
    const shell = await spawnSh(first, dir, `cat "${input}"; exit 3`);
    first.close();
    NodeFS.writeFileSync(input, "go\n");

    const second = await connect(dir);
    const [taken] = await second.list();
    expect(await exitOf(taken!.process)).toEqual({ exitCode: 3, signal: null });
    expect((await second.list()).map((entry) => entry.session.exit)).toEqual([
      { exitCode: 3, signal: null },
    ]);
    second.forget(shell.pid);
    expect(await second.list()).toEqual([]);
  });

  it("reports a shell ended by a signal", async () => {
    const dir = stateDir();
    await start(dir);
    const connection = await connect(dir);
    const shell = await spawnSh(connection, dir, "echo ready; read line");
    await outputContains(shell, "", "ready");
    process.kill(shell.pid, "SIGKILL");
    expect(await exitOf(shell)).toEqual({ exitCode: 0, signal: 9 });
  });

  it("ends its shells when it stops, which the server sees as lost", async () => {
    const dir = stateDir();
    const host = await start(dir);
    const connection = await connect(dir);
    const shell = await spawnSh(connection, dir, "echo ready; read line");
    await outputContains(shell, "", "ready");
    host.stop();
    expect(await exitOf(shell)).toEqual({ exitCode: 0, signal: 1 });
  });

  it("answers a server of another version with its own and hangs up", async () => {
    const dir = stateDir();
    await start(dir);
    const replies: Array<unknown> = [];
    await new Promise<void>((resolve) => {
      const socket = NodeNet.connect(shellHostSocketPath(dir));
      socket.setEncoding("utf8");
      socket.on(
        "data",
        lineReader((message) => replies.push(message)),
      );
      socket.on("connect", () => socket.write(encodeLine({ t: "hello", version: 99 })));
      socket.on("close", () => resolve());
    });
    expect(replies).toEqual([{ t: "hello", version: 1, pid: process.pid }]);
  });

  it("stops by itself with no shells and no server, and serves a state folder once", async () => {
    const dir = stateDir();
    const host: RunningShellHost = await start(dir, 1);
    expect(await startShellHost({ stateDir: dir })).toBeNull();
    await host.finished;
    expect(NodeFS.existsSync(shellHostSocketPath(dir))).toBe(false);
  });

  it("puts the socket in the temp folder when the state folder's path is too long", () => {
    const short = "/tmp/state";
    expect(shellHostSocketPath(short)).toBe("/tmp/state/shell-host-v1.sock");
    const long = `/tmp/${"a".repeat(120)}`;
    const socket = shellHostSocketPath(long);
    expect(socket.startsWith(NodeOS.tmpdir())).toBe(true);
    expect(socket).toMatch(/probe-shell-[0-9a-f]{12}-v1\.sock$/);
  });
});

describe("shell host client", () => {
  effectIt.effect(
    "stops waiting as soon as a host that cannot serve exits, and says where it wrote why",
    () =>
      Effect.gen(function* () {
        const dir = stateDir();
        let starts = 0;
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const host = yield* make({
              socketPath: shellHostSocketPath(dir),
              logPath: `${dir}/shell-host-v1.log`,
              start: Effect.sync(() => {
                starts++;
                return { exited: () => true };
              }),
            });
            return yield* host.adapter.spawn({
              shell: "/bin/sh",
              cwd: dir,
              cols: 80,
              rows: 24,
              env: {},
            });
          }),
        );
        expect(starts).toBe(1);
        expect(String(exit)).toContain(
          `The shell host did not start; see ${dir}/shell-host-v1.log.`,
        );
      }).pipe(Effect.scoped),
  );
});
