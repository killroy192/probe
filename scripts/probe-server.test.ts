// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Drives the real shell command against a fake installed server.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SCRIPT = NodePath.resolve(import.meta.dirname, "probe-server.sh");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const NEWER = "fedcba9876543210fedcba9876543210fedcba98";

// Mirrors the real server: a runtime record in the real shape, the readiness path,
// a startup token unless PROBE_STARTUP_PAIRING=0, `pair` in its own process, and a
// shell host that writes its pid file into the state folder it is given.
const FAKE_SERVER = `import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
const args = process.argv.slice(2);
if (args[0] === "__shell-host") {
  fs.appendFileSync(process.env.FAKE_PIDS, process.pid + "\\n");
  fs.mkdirSync(args[1], { recursive: true });
  fs.writeFileSync(path.join(args[1], "shell-host-v1.pid"), process.pid + "\\n");
  setInterval(() => {}, 1 << 30);
  console.log("hosting");
} else {
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runtimePath = path.join(flag("--base-dir"), "userdata", "server-runtime.json");
if (args[0] === "pair") {
  const { port } = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  const token = "pair-token-" + process.pid;
  console.log("▄▀▄ qr ▄▀▄");
  console.log("Pairing URL: http://172.17.0.2:" + port + "/pair#token=" + token);
  console.log("Token: " + token);
  console.log("Expires: 2026-11-12T00:05:00.000Z");
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_PIDS, process.pid + "\\n");
if (process.env.FAKE_SERVER_MODE === "exit") process.exit(1);
const host = flag("--host");
const server = http.createServer((request, response) => {
  const ready = process.env.FAKE_SERVER_MODE !== "never-ready";
  response.statusCode = ready && request.url === "/.well-known/t3/environment" ? 200 : 503;
  response.end("{}");
});
server.listen(Number(flag("--port") ?? 0), host, () => {
  const { port } = server.address();
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, JSON.stringify({
    version: 1, pid: process.pid, host, port, origin: "http://127.0.0.1:" + port,
    startedAt: new Date().toISOString(), serverVersion: "0.1.5",
  }) + "\\n");
  if (process.env.PROBE_STARTUP_PAIRING !== "0") console.log("Token: startup-token");
  console.log("listening");
});
process.on("SIGTERM", () => {
  fs.rmSync(runtimePath, { force: true });
  process.exit(0);
});
}
`;

interface Result {
  readonly code: number | null;
  readonly output: string;
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = NodeNet.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      server.close(() => resolve(port));
    });
  });

// A zombie still answers kill(0), so read the process state instead.
const serving = (pid: number) => {
  try {
    return !/^\d+ \(.*\) [ZX]/s.test(NodeFS.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
};

const fixture = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "probe-server-"));
  const path = (...parts: Array<string>) => NodePath.join(root, ...parts);
  const build = path("install/versions", COMMIT);
  const state = path("state");
  const command = path("install/probe-server");
  const others = new Set<NodeChildProcess.ChildProcess>();

  await NodeFSP.mkdir(NodePath.join(build, "scripts"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(build, "apps/server/dist"), { recursive: true });
  await NodeFSP.mkdir(path("home"));
  await NodeFSP.copyFile(SCRIPT, NodePath.join(build, "scripts/probe-server.sh"));
  await NodeFSP.chmod(NodePath.join(build, "scripts/probe-server.sh"), 0o755);
  await NodeFSP.writeFile(NodePath.join(build, "apps/server/dist/bin.mjs"), FAKE_SERVER);
  await NodeFSP.writeFile(
    NodePath.join(build, "apps/server/package.json"),
    JSON.stringify({ version: "0.1.5" }),
  );
  await NodeFSP.writeFile(NodePath.join(build, ".install-complete"), `${COMMIT}\n`);
  await NodeFSP.symlink(`versions/${COMMIT}`, path("install/current"));
  await NodeFSP.symlink("current/scripts/probe-server.sh", command);

  const env = (extra: Record<string, string>) => ({
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: path("home"),
    FAKE_PIDS: path("pids"),
    ...extra,
  });

  // Detached, so a test can end the "session" by killing the command's process group.
  const spawn = (
    args: ReadonlyArray<string>,
    extra: Record<string, string> = {},
    script = command,
  ) => {
    const child = NodeChildProcess.spawn(script, args, {
      detached: true,
      env: env(extra),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const result = new Promise<Result>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
    return { child, result };
  };
  const run = (args: ReadonlyArray<string>, extra: Record<string, string> = {}, script?: string) =>
    spawn(args, extra, script).result;

  const untilPrinted = (child: NodeChildProcess.ChildProcess, text: string) =>
    new Promise<void>((resolve) =>
      child.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes(text)) resolve();
      }),
    );

  const pids = async () =>
    (await NodeFSP.readFile(path("pids"), "utf8").catch(() => ""))
      .split("\n")
      .filter((line) => line.length > 0)
      .map(Number);
  const runtime = async (): Promise<{ pid: number; port: number } | null> =>
    JSON.parse(
      await NodeFSP.readFile(NodePath.join(state, "userdata/server-runtime.json"), "utf8").catch(
        () => "null",
      ),
    );

  return {
    path,
    build,
    state,
    command,
    spawn,
    run,
    pids,
    runtime,
    log: () => NodeFSP.readFile(NodePath.join(state, "probe-server.log"), "utf8"),
    // A server another tool started on the same state folder.
    startElsewhere: async () => {
      const child = NodeChildProcess.spawn(
        process.execPath,
        [
          NodePath.join(build, "apps/server/dist/bin.mjs"),
          "serve",
          "--port",
          "0",
          "--base-dir",
          state,
        ],
        { env: env({}), stdio: ["ignore", "pipe", "ignore"] },
      );
      others.add(child);
      await untilPrinted(child, "listening");
      return child.pid!;
    },
    // The detached shell host a server of this build starts for the state folder.
    startShellHost: async () => {
      const child = NodeChildProcess.spawn(
        process.execPath,
        [
          NodePath.join(build, "apps/server/dist/bin.mjs"),
          "__shell-host",
          NodePath.join(state, "userdata"),
        ],
        { env: env({}), stdio: ["ignore", "pipe", "ignore"] },
      );
      others.add(child);
      await untilPrinted(child, "hosting");
      return child;
    },
    // What install-server.sh leaves after a newer build: it beside the old one, current on it.
    upgrade: async () => {
      const newer = path("install/versions", NEWER);
      await NodeFSP.cp(build, newer, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(newer, "apps/server/package.json"),
        JSON.stringify({ version: "0.1.6" }),
      );
      await NodeFSP.writeFile(NodePath.join(newer, ".install-complete"), `${NEWER}\n`);
      await NodeFSP.utimes(NodePath.join(build, ".install-complete"), 1, 1);
      await NodeFSP.symlink(`versions/${NEWER}`, path("install/.current"));
      await NodeFSP.rename(path("install/.current"), path("install/current"));
    },
    async [Symbol.asyncDispose]() {
      // Every fake server records its pid at start; these are the only processes killed.
      for (const pid of await pids()) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      for (const child of others) child.kill("SIGKILL");
      await NodeFSP.rm(root, { recursive: true, force: true });
    },
  };
};

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")("probe-server.sh", () => {
  it("starts detached on the given port, bind and folder, then reports, reuses, pairs and stops", async () => {
    await using fx = await fixture();
    const port = await freePort();
    const log = NodePath.join(fx.state, "probe-server.log");

    const started = fx.spawn([
      "start",
      "--port",
      `${port}`,
      "--host",
      "127.0.0.1",
      "--base-dir",
      fx.state,
    ]);
    const start = await started.result;
    expect(start.code, start.output).toBe(0);
    for (const line of [
      `Probe server 0.1.5 (${COMMIT.slice(0, 7)})`,
      `Address:      http://127.0.0.1:${port}`,
      `Port:         ${port}`,
      "Bind:         127.0.0.1",
      `State folder: ${fx.state}`,
      `Log:          ${log}`,
    ]) {
      expect(start.output).toContain(line);
    }
    expect(start.output).not.toContain("Note:");

    // The session ends: its whole process group goes; the server is not in it.
    try {
      process.kill(-started.child.pid!, "SIGKILL");
    } catch {}
    const server = (await fx.runtime())!;
    expect(serving(server.pid)).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`)).status).toBe(200);

    const running = await fx.run(["status", "--base-dir", fx.state]);
    expect(running.code, running.output).toBe(0);
    expect(running.output).toContain(`Running:      yes (pid ${server.pid})`);
    expect(running.output).toContain(`Port:         ${port}`);
    expect(running.output).toContain("Bind:         127.0.0.1");

    const again = await fx.run(["start", "--base-dir", fx.state]);
    expect(again.code, again.output).toBe(0);
    expect(again.output).toContain(`already runs for this state folder (pid ${server.pid})`);
    expect(again.output).toContain(`Port:         ${port}`);
    expect(await fx.pids()).toEqual([server.pid]);

    const paired = await fx.run(["pair", "--base-dir", fx.state]);
    expect(paired.code, paired.output).toBe(0);
    const token = /Token: +(\S+)/.exec(paired.output)?.[1];
    expect(token).toMatch(/^pair-token-/);
    expect(paired.output).toContain(`Pairing URL:  http://127.0.0.1:${port}/pair#token=${token}`);
    const written = await fx.log();
    expect(written).not.toContain(token);
    expect(written).not.toContain("startup-token");

    const stopped = await fx.run(["stop", "--base-dir", fx.state]);
    expect(stopped.code, stopped.output).toBe(0);
    expect(stopped.output).toContain("Shells keep running");
    expect(serving(server.pid)).toBe(false);

    const stoppedAgain = await fx.run(["stop", "--base-dir", fx.state]);
    expect(stoppedAgain.code).not.toBe(0);
    expect(stoppedAgain.output).toContain("nothing to stop");

    const idle = await fx.run(["status", "--base-dir", fx.state]);
    expect(idle.code).toBe(3);
    for (const line of ["Probe server 0.1.5", "Running:      no", "Port:         none"]) {
      expect(idle.output).toContain(line);
    }
    expect(idle.output).toContain("Bind:         none");

    const unpaired = await fx.run(["pair", "--base-dir", fx.state]);
    expect(unpaired.code).not.toBe(0);
    expect(unpaired.output).toContain(`${fx.command} start --base-dir ${fx.state}`);
  });

  it("lets the server choose a free port and marks a wildcard bind in start and pair", async () => {
    await using fx = await fixture();

    const start = await fx.run(["start", "--host", "0.0.0.0"]);
    expect(start.code, start.output).toBe(0);
    const home = NodePath.join(fx.path("home"), ".probe");
    const record = JSON.parse(
      await NodeFSP.readFile(NodePath.join(home, "userdata/server-runtime.json"), "utf8"),
    ) as { port: number };
    expect(start.output).toContain(`State folder: ${home}`);
    expect(start.output).toContain(`Port:         ${record.port}`);
    expect(start.output).toContain(
      `Address:      http://<address you reach this server at>:${record.port}`,
    );
    expect(start.output).toContain("Bind:         0.0.0.0");
    expect(start.output).toMatch(/Note: clients use the address they reach/);

    const paired = await fx.run(["pair"]);
    expect(paired.code, paired.output).toBe(0);
    expect(paired.output).toMatch(
      new RegExp(
        `Pairing URL: +http://<address you reach this server at>:${record.port}/pair#token=pair-token-`,
      ),
    );
    expect(paired.output).toMatch(/Note: put the address you reach/);

    const stopped = await fx.run(["stop"]);
    expect(stopped.code, stopped.output).toBe(0);
  });

  it("refuses a busy explicit port by name and starts nothing", async () => {
    await using fx = await fixture();
    const holder = NodeNet.createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const { port } = holder.address() as NodeNet.AddressInfo;

    const start = await fx.run(["start", "--port", `${port}`, "--base-dir", fx.state]);
    holder.close();

    expect(start.code).not.toBe(0);
    expect(start.output).toContain(`Port ${port} on 127.0.0.1 is already in use`);
    expect(await fx.pids()).toEqual([]);
  });

  it.each([
    ["has exited", () => NodeChildProcess.spawnSync("true").pid],
    ["now belongs to an unrelated process", () => process.pid],
  ])("treats a record whose pid %s as not running and starts a new server", async (_, pid) => {
    await using fx = await fixture();
    const stale = pid();
    await NodeFSP.mkdir(NodePath.join(fx.state, "userdata"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(fx.state, "userdata/server-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: stale,
        host: "127.0.0.1",
        port: 1,
        origin: "x",
        startedAt: "",
      }),
    );
    await NodeFSP.writeFile(
      NodePath.join(fx.state, "probe-server.launch"),
      `pid=${stale}\nroot=${fx.path("install")}\n`,
    );

    const status = await fx.run(["status", "--base-dir", fx.state]);
    expect(status.code).toBe(3);
    expect(status.output).toContain("Running:      no");

    const start = await fx.run(["start", "--base-dir", fx.state]);
    expect(start.code, start.output).toBe(0);
    expect(start.output).toContain("Started Probe server");
    const [server] = await fx.pids();
    expect(server).not.toBe(stale);
    expect(serving(server!)).toBe(true);
    expect(serving(stale)).toBe(stale === process.pid);
  });

  it.each([
    [
      "does not answer in time",
      { FAKE_SERVER_MODE: "never-ready", PROBE_SERVER_READY_SECONDS: "1" },
      "did not answer within 1 s",
    ],
    ["exits during start", { FAKE_SERVER_MODE: "exit" }, "exited during start"],
  ])(
    "fails with the log path and leaves nothing running when the server %s",
    async (_, env, reason) => {
      await using fx = await fixture();

      const start = await fx.run(["start", "--base-dir", fx.state], env);

      expect(start.code).not.toBe(0);
      expect(start.output).toContain(reason);
      expect(start.output).toContain(`Log: ${NodePath.join(fx.state, "probe-server.log")}`);
      const started = await fx.pids();
      expect(started).toHaveLength(1);
      expect(serving(started[0]!)).toBe(false);
      const status = await fx.run(["status", "--base-dir", fx.state]);
      expect(status.output).toContain("Running:      no");
    },
  );

  it("reuses a server another tool started on the folder but refuses to stop it", async () => {
    await using fx = await fixture();
    const elsewhere = await fx.startElsewhere();

    const start = await fx.run(["start", "--base-dir", fx.state]);
    expect(start.code, start.output).toBe(0);
    expect(start.output).toContain(`already runs for this state folder (pid ${elsewhere})`);

    const stop = await fx.run(["stop", "--base-dir", fx.state]);
    expect(stop.code).not.toBe(0);
    expect(stop.output).toContain("this install did not start it");
    expect(serving(elsewhere)).toBe(true);
  });

  it.each([
    [
      "no completion marker",
      (build: string) => NodeFSP.rm(NodePath.join(build, ".install-complete")),
    ],
    [
      "no built server",
      (build: string) => NodeFSP.rm(NodePath.join(build, "apps/server/dist/bin.mjs")),
    ],
  ])("says the install is missing when it has %s, for every command", async (_, breakInstall) => {
    await using fx = await fixture();
    await breakInstall(fx.build);

    for (const command of ["start", "status", "pair", "stop"]) {
      const result = await fx.run([command, "--base-dir", fx.state]);
      expect(result.code, command).not.toBe(0);
      expect(result.output, command).toContain("not installed");
      expect(result.output, command).toContain("install-server.sh");
    }
    expect(await fx.pids()).toEqual([]);
  });
  it("shows the running build beside the installed versions after an upgrade until a restart", async () => {
    await using fx = await fixture();
    const old = `0.1.5 (${COMMIT.slice(0, 7)}`;
    const newer = `0.1.6 (${NEWER.slice(0, 7)}`;
    expect((await fx.run(["start", "--base-dir", fx.state])).code).toBe(0);

    await fx.upgrade();
    const before = await fx.run(["status", "--base-dir", fx.state]);
    expect(before.code, before.output).toBe(0);
    expect(before.output).toContain(`Installed:    ${newer}, current), ${old}, running)`);
    expect(before.output).toContain(
      `Note: the server runs ${old}), not the installed current ${newer}); stop and start it to switch.`,
    );

    expect((await fx.run(["stop", "--base-dir", fx.state])).code).toBe(0);
    expect((await fx.run(["start", "--base-dir", fx.state])).code).toBe(0);
    const after = await fx.run(["status", "--base-dir", fx.state]);
    expect(after.output).toContain(`Installed:    ${newer}, current, running), ${old})`);
    expect(after.output).not.toContain("Note: the server runs");
  });

  it("uninstalls only once no server runs, keeps the state folder unless asked, and refuses data under a live shell host", async () => {
    await using fx = await fixture();
    const root = fx.path("install");
    const listing = async (dir: string) => {
      const entries = await NodeFSP.readdir(dir, { recursive: true }).catch(() => null);
      if (entries === null) return null;
      return Promise.all(
        entries.toSorted().map(async (entry) => {
          const full = NodePath.join(dir, entry);
          const stat = await NodeFSP.lstat(full);
          return stat.isFile() ? `${entry}: ${await NodeFSP.readFile(full, "utf8")}` : entry;
        }),
      );
    };
    await NodeFSP.mkdir(fx.path("install/build"));
    await NodeFSP.mkdir(fx.path("install/logs"));
    await NodeFSP.writeFile(fx.path("install/logs/install.log"), "built\n");
    expect((await fx.run(["start", "--base-dir", fx.state])).code).toBe(0);
    const server = (await fx.runtime())!.pid;
    const shellHost = await fx.startShellHost();
    const host = shellHost.pid!;
    await NodeFSP.mkdir(NodePath.join(fx.state, "userdata/workspaces"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(fx.state, "userdata/workspaces/w.json"), "{}");

    const installed = await listing(root);
    const refused = await fx.run(["uninstall"]);
    expect(refused.code).not.toBe(0);
    expect(refused.output).toContain("still running. Nothing was removed. Stop it first");
    expect(refused.output).toContain(
      `pid ${server}: ${root}/probe-server stop --base-dir ${fx.state}`,
    );
    expect(await listing(root)).toEqual(installed);

    expect((await fx.run(["stop", "--base-dir", fx.state])).code).toBe(0);
    const kept = await listing(fx.state);
    const removed = await fx.run(["uninstall"]);
    expect(removed.code, removed.output).toBe(0);
    for (const line of [
      `Removed: ${root}/probe-server`,
      `Removed: ${root}/current`,
      `Removed: ${root}/build`,
      `Removed: ${root}/versions (0.1.5 (${COMMIT.slice(0, 7)}, current))`,
      `Removed: ${root}/logs`,
      `Removed: ${root} (it was empty)`,
      "Kept:    state folders such as ~/.probe",
      `a shell host from this install still runs (pid ${host})`,
    ]) {
      expect(removed.output).toContain(line);
    }
    expect(await listing(root)).toBeNull();
    expect(await listing(fx.state)).toEqual(kept);
    expect(serving(host)).toBe(true);

    // The command is gone with the install; the script fetched again finds nothing.
    const env = { PROBE_INSTALL_DIR: root };
    const again = await fx.run(["uninstall"], env, SCRIPT);
    expect(again.code, again.output).toBe(0);
    expect(again.output).toContain(`Nothing is installed in ${root}`);

    const data = ["uninstall", "--remove-data", "--base-dir", fx.state];
    const busy = await fx.run(data, env, SCRIPT);
    expect(busy.code).not.toBe(0);
    expect(busy.output).toContain(`The shell host of ${fx.state} still runs (pid ${host})`);
    expect(await listing(fx.state)).toEqual(kept);

    shellHost.kill("SIGKILL");
    await new Promise((resolve) => shellHost.once("exit", resolve));
    const wiped = await fx.run(data, env, SCRIPT);
    expect(wiped.code, wiped.output).toBe(0);
    expect(wiped.output).toContain(`Removed: ${fx.state} (state folder)`);
    expect(await listing(fx.state)).toBeNull();
  });

  // Root removes a read-only folder anyway.
  it.skipIf(process.getuid?.() === 0)(
    "names what it could not remove and the fix, and exits non-zero",
    async () => {
      await using fx = await fixture();
      const locked = NodePath.join(fx.build, "apps");
      await NodeFSP.chmod(locked, 0o555);
      const result = await fx.run(["uninstall"]);
      await NodeFSP.chmod(locked, 0o755);

      const versions = fx.path("install/versions");
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(`Could not remove ${versions}: `);
      expect(result.output).toContain(`Fix: chmod -R u+w '${versions}' && rm -rf '${versions}'`);
      expect(result.output).not.toContain(`Removed: ${fx.path("install")} (it was empty)`);
    },
  );
});
