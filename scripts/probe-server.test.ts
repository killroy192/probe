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

// Mirrors the real server: a runtime record in the real shape, the readiness path,
// a startup token unless PROBE_STARTUP_PAIRING=0, and `pair` in its own process.
const FAKE_SERVER = `import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
const args = process.argv.slice(2);
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
  const spawn = (args: ReadonlyArray<string>, extra: Record<string, string> = {}) => {
    const child = NodeChildProcess.spawn(command, args, {
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
  const run = (args: ReadonlyArray<string>, extra: Record<string, string> = {}) =>
    spawn(args, extra).result;

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
      await new Promise<void>((resolve) =>
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("listening")) resolve();
        }),
      );
      return child.pid!;
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
});
