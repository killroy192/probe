// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Drives the real shell installer against a local repository fixture.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SCRIPT = NodePath.resolve(import.meta.dirname, "install-server.sh");
// Everything the script, git and the fakes call; the tests drop entries to fake a missing tool.
const TOOLS = [
  "cat",
  "cp",
  "curl",
  "date",
  "df",
  "dirname",
  "env",
  "getconf",
  "git",
  "grep",
  "id",
  "ln",
  "mkdir",
  "mktemp",
  "mv",
  "node",
  "nohup",
  "ps",
  "readlink",
  "rm",
  "rmdir",
  "sleep",
  "uname",
];
const BUILD_TOOLS = ["make", "g++", "python3"];

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = NodeNet.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as NodeNet.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const answers = async (port: number) =>
  (await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`)).status === 200;

const which = (tool: string) =>
  NodeChildProcess.execFileSync("/bin/sh", ["-c", `command -v ${tool}`], {
    encoding: "utf8",
  }).trim();

const GOOD_SERVER = `import * as http from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((request, response) => {
  response.statusCode = request.url === "/.well-known/t3/environment" ? 200 : 404;
  response.end("{}");
}).listen(port, "127.0.0.1", () => console.log("listening"));
`;
const EXITING_SERVER = `process.exit(1);\n`;

// A gate blocks a tool until the test releases it, so a test can act at an exact phase.
const gate = (phase: string) =>
  `if [ "\${PROBE_TEST_GATE:-}" = ${phase} ]; then printf x > "$GATE_READY"; read _ < "$GATE_RELEASE"; fi`;

const FAKE_VP = `#!/bin/sh
[ "$1" = i ] && exit 0
${gate("build")}
[ "\${FAKE_BUILD:-}" = fail ] && { echo "fake build failed" >&2; exit 1; }
mkdir -p apps/server/dist && cp "$FAKE_SERVER" apps/server/dist/bin.mjs
`;

interface Run {
  readonly child: NodeChildProcess.ChildProcess;
  readonly result: Promise<{ code: number | null; output: string }>;
  readonly printed: (text: string) => Promise<void>;
}

interface RunOptions {
  readonly env?: Record<string, string>;
  readonly omit?: ReadonlyArray<string>;
  readonly fakes?: Record<string, string>;
  readonly piped?: boolean;
}

const fixture = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "probe-install-server-"));
  const children = new Set<NodeChildProcess.ChildProcess>();
  const servers = new Set<NodeChildProcess.ChildProcess>();
  const path = (...parts: Array<string>) => NodePath.join(root, ...parts);
  const repo = path("repo");
  const install = path("install");
  const git = (...args: Array<string>) =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd: repo, encoding: "utf8" },
    ).trim();
  const commit = async (version: string) => {
    await NodeFSP.mkdir(path("repo/apps/server"), { recursive: true });
    await NodeFSP.writeFile(path("repo/apps/server/package.json"), JSON.stringify({ version }));
    git("add", ".");
    git("commit", "-qm", version);
    return git("rev-parse", "HEAD");
  };

  await NodeFSP.mkdir(repo);
  await NodeFSP.mkdir(path("home"));
  git("init", "-qb", "main");
  await NodeFSP.writeFile(path("registry"), "{}");
  await NodeFSP.writeFile(path("good.mjs"), GOOD_SERVER);
  await NodeFSP.writeFile(path("exiting.mjs"), EXITING_SERVER);
  NodeChildProcess.execFileSync("mkfifo", [path("ready"), path("release")]);
  const real = Object.fromEntries(TOOLS.map((tool) => [tool, which(tool)]));
  let bins = 0;

  const makeBin = async ({ omit = [], fakes = {} }: RunOptions) => {
    const bin = path(`bin-${bins++}`);
    await NodeFSP.mkdir(bin);
    const scripts: Record<string, string> = {
      git: `#!/bin/sh\n[ "$1" = clone ] && echo clone >> "$CLONE_LOG"\n${gate("fetch")}\nexec ${real.git} "$@"\n`,
      ln: `#!/bin/sh\n${gate("switch")}\nexec ${real.ln} "$@"\n`,
      vp: FAKE_VP,
      ...Object.fromEntries(BUILD_TOOLS.map((tool) => [tool, "#!/bin/sh\nexit 0\n"])),
      ...fakes,
    };
    for (const tool of [...TOOLS, ...BUILD_TOOLS, "vp"]) {
      if (omit.includes(tool)) continue;
      const target = NodePath.join(bin, tool);
      const script = scripts[tool];
      if (script === undefined) {
        await NodeFSP.symlink(real[tool]!, target);
      } else {
        await NodeFSP.writeFile(target, script, { mode: 0o755 });
      }
    }
    return bin;
  };

  const run = async (options: RunOptions = {}): Promise<Run> => {
    const child = NodeChildProcess.spawn("/bin/sh", options.piped ? [] : [SCRIPT], {
      detached: true,
      env: {
        PATH: await makeBin(options),
        HOME: path("home"),
        PROBE_REPO: repo,
        PROBE_INSTALL_DIR: install,
        PROBE_REGISTRY: `file://${path("registry")}`,
        PROBE_MIN_DISK_KB: "0",
        PROBE_MIN_MEM_KB: "0",
        FAKE_SERVER: path("good.mjs"),
        GATE_READY: path("ready"),
        GATE_RELEASE: path("release"),
        CLONE_LOG: path("clones"),
        ...options.env,
      },
      stdio: [options.piped ? "pipe" : "ignore", "pipe", "pipe"],
    });
    children.add(child);
    if (options.piped) child.stdin?.end(await NodeFSP.readFile(SCRIPT));
    let output = "";
    const waiters: Array<{ text: string; resolve: () => void }> = [];
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      for (const waiter of waiters.filter(({ text }) => output.includes(text))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const result = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        children.delete(child);
        resolve({ code, output });
      });
    });
    const printed = (text: string) =>
      output.includes(text)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ text, resolve }));
    return { child, result, printed };
  };

  // A server the user started from an installed version; the install must leave it running.
  const serve = async (commit: string) => {
    const port = await freePort();
    const child = NodeChildProcess.spawn(
      process.execPath,
      [path("install/versions", commit, "apps/server/dist/bin.mjs"), "serve", "--port", `${port}`],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    servers.add(child);
    await new Promise<void>((resolve) =>
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) resolve();
      }),
    );
    return { child, port };
  };

  // Every path under the install root but the logs, with link targets and markers.
  const files = async () => {
    const entries = await NodeFSP.readdir(install, { recursive: true });
    const listed = [];
    for (const entry of entries.filter((name) => !name.startsWith("logs")).toSorted()) {
      const full = NodePath.join(install, entry);
      const stat = await NodeFSP.lstat(full);
      listed.push(
        stat.isSymbolicLink()
          ? `${entry} -> ${await NodeFSP.readlink(full)}`
          : `${entry} ${stat.mtimeMs}`,
      );
    }
    return listed;
  };

  const state = async () => {
    const versions = await NodeFSP.readdir(path("install/versions")).catch(() => []);
    const complete = [];
    for (const version of versions) {
      const marker = await NodeFSP.readFile(
        path("install/versions", version, ".install-complete"),
        "utf8",
      ).catch(() => "");
      if (marker.trim() === version) complete.push(version);
    }
    return {
      complete,
      current: await NodeFSP.readlink(path("install/current")).catch(() => null),
      leftovers: [
        ...(await NodeFSP.readdir(path("install/build")).catch(() => [])),
        ...(await NodeFSP.readdir(install).catch(() => [])).filter(
          (name) =>
            name === "install.lock" ||
            name.startsWith(".current.") ||
            name.startsWith(".probe-server."),
        ),
      ],
      clones:
        (await NodeFSP.readFile(path("clones"), "utf8").catch(() => "")).split("\n").length - 1,
    };
  };

  return {
    path,
    install,
    commit,
    run,
    serve,
    files,
    state,
    // A run killed at a gate dies with its whole process group.
    kill: (child: NodeChildProcess.ChildProcess) => process.kill(-child.pid!, "SIGKILL"),
    ready: () => NodeFSP.readFile(path("ready")),
    release: () => NodeFSP.writeFile(path("release"), "x"),
    async [Symbol.asyncDispose]() {
      for (const child of children) process.kill(-child.pid!, "SIGKILL");
      for (const child of servers) child.kill("SIGKILL");
      await NodeFSP.rm(root, { recursive: true, force: true });
    },
  };
};

const installed = async (fx: Awaited<ReturnType<typeof fixture>>, env = {}) => {
  const { code, output } = await (await fx.run({ env })).result;
  expect(code, output).toBe(0);
};

describe.skipIf(HostProcess.Platform.defaultValue() !== "linux")("install-server.sh", () => {
  it("builds, proves and switches when piped, and a re-run of that commit neither clones, changes anything nor stops a running server", async () => {
    await using fx = await fixture();
    const commit = await fx.commit("0.1.5");

    const first = await (await fx.run({ piped: true })).result;
    expect(first.code, first.output).toBe(0);
    expect(first.output).toContain(`0.1.5 (${commit.slice(0, 7)})`);
    expect(first.output).toContain(`${fx.install}/probe-server start --port <port>`);
    expect(first.output).not.toContain("Restart:");
    expect(first.output.trimEnd().split("\n").length).toBeLessThanOrEqual(15);
    expect(await NodeFSP.readlink(fx.path("install/probe-server"))).toBe(
      "current/scripts/probe-server.sh",
    );
    expect(await fx.state()).toEqual({
      complete: [commit],
      current: `versions/${commit}`,
      leftovers: [],
      clones: 1,
    });

    const server = await fx.serve(commit);
    const before = await fx.files();
    const again = await (await fx.run()).result;
    expect(again.code, again.output).toBe(0);
    expect(again.output).toMatch(/already installed; nothing changed/);
    expect(again.output).not.toContain("Restart:");
    expect(await fx.state()).toMatchObject({ complete: [commit], clones: 1 });
    expect(await fx.files()).toEqual(before);
    expect(await answers(server.port)).toBe(true);
  });

  it.each<[string, RunOptions, ReadonlyArray<string>]>([
    ["root", { fakes: { id: "#!/bin/sh\necho 0\n" } }, ["docker exec -u"]],
    ["no git", { omit: ["git"] }, ["- git:"]],
    ["no node", { omit: ["node"] }, ["- node:"]],
    ["an old node", { fakes: { node: "#!/bin/sh\necho 22.11.0\n" } }, ["- node: version 22.11.0"]],
    [
      "no vp and no build tools",
      { omit: ["vp", ...BUILD_TOOLS] },
      ["- vp:", "- make:", "- g++:", "- python3:"],
    ],
    ["no download tool", { omit: ["curl"] }, ["- curl or wget:"]],
    ["no process tools", { omit: ["ps", "mktemp", "nohup"] }, ["- ps:", "- mktemp:", "- nohup:"]],
    [
      "an unsupported CPU",
      { fakes: { uname: '#!/bin/sh\n[ "$1" = -m ] && echo riscv64 || echo Linux\n' } },
      ["- CPU:"],
    ],
    ["a home folder it cannot write", { env: { HOME: "/" } }, ["- home folder:"]],
    ["musl instead of glibc", { fakes: { getconf: "#!/bin/sh\nexit 1\n" } }, ["- libc:"]],
    ["an unreachable repository", { env: { PROBE_REPO: "/nonexistent/repo" } }, ["- repository:"]],
    [
      "a missing ref, small disk and memory, no registry",
      {
        env: {
          PROBE_REF: "no-such-branch",
          PROBE_MIN_DISK_KB: "999999999999",
          PROBE_MIN_MEM_KB: "999999999999",
          PROBE_REGISTRY: "file:///nonexistent/registry",
        },
      },
      ["- repository:", "- disk space:", "- memory:", "- package registry:"],
    ],
  ])(
    "refuses a target with %s, listing every problem and installing nothing",
    async (_, options, items) => {
      await using fx = await fixture();
      await fx.commit("0.1.5");

      const { code, output } = await (await fx.run(options)).result;

      expect(code, output).not.toBe(0);
      for (const item of items) expect(output).toContain(item);
      const written = await NodeFSP.readdir(fx.install).catch(() => []);
      expect(written.filter((name) => name !== "logs")).toEqual([]);
    },
  );

  it.each([
    ["the build fails", { FAKE_BUILD: "fail" }],
    ["the built server does not start", { FAKE_SERVER: "exiting.mjs" }],
  ])("keeps the previous install current when %s", async (_, env) => {
    await using fx = await fixture();
    const previous = await fx.commit("0.1.5");
    await installed(fx);
    await fx.commit("0.1.6");
    const server = await fx.serve(previous);

    const { code, output } = await (
      await fx.run({
        env: Object.fromEntries(
          Object.entries(env).map(([key, value]) => [
            key,
            value.endsWith(".mjs") ? fx.path(value) : value,
          ]),
        ),
      })
    ).result;

    expect(code, output).not.toBe(0);
    const log = /Log: (\S+)/.exec(output)?.[1];
    expect(log && (await NodeFSP.stat(log)).isFile()).toBe(true);
    expect(output).not.toContain("Restart:");
    expect(await fx.state()).toMatchObject({
      complete: [previous],
      current: `versions/${previous}`,
      leftovers: [],
    });
    expect(await answers(server.port)).toBe(true);
    expect(await answers((await fx.serve(previous)).port)).toBe(true);
  });

  it.each(["fetch", "build", "switch"])(
    "keeps the old install running when an upgrade is killed during %s, and the next run installs beside it and asks for a restart",
    async (phase) => {
      await using fx = await fixture();
      const previous = await fx.commit("0.1.5");
      await installed(fx);
      const next = await fx.commit("0.1.6");
      const server = await fx.serve(previous);

      const killed = await fx.run({ env: { PROBE_TEST_GATE: phase } });
      await fx.ready();
      expect((await fx.state()).current).toBe(`versions/${previous}`);
      fx.kill(killed.child);
      await killed.result;
      expect((await fx.state()).current).toBe(`versions/${previous}`);
      expect(await answers((await fx.serve(previous)).port)).toBe(true);

      const upgrade = await (await fx.run()).result;
      expect(upgrade.code, upgrade.output).toBe(0);
      expect(upgrade.output).toContain(
        `Restart: a running server keeps 0.1.5 (${previous.slice(0, 7)}) until you stop and start it; nothing was stopped.`,
      );
      expect(upgrade.output.trimEnd().split("\n").length).toBeLessThanOrEqual(15);
      const after = await fx.state();
      expect(after).toMatchObject({ current: `versions/${next}`, leftovers: [] });
      expect(after.complete.toSorted()).toEqual([previous, next].toSorted());
      expect(await answers(server.port)).toBe(true);
    },
  );

  it("lets a second run wait for the first and end with one complete install", async () => {
    await using fx = await fixture();
    const commit = await fx.commit("0.1.5");

    const first = await fx.run({ env: { PROBE_TEST_GATE: "build" } });
    await fx.ready();
    const second = await fx.run();
    await second.printed("Waiting for another install");
    await fx.release();

    const [a, b] = await Promise.all([first.result, second.result]);
    expect(a.code, a.output).toBe(0);
    expect(b.code, b.output).toBe(0);
    expect(b.output).toMatch(/nothing changed/);
    expect(await fx.state()).toEqual({
      complete: [commit],
      current: `versions/${commit}`,
      leftovers: [],
      clones: 1,
    });
  });
});
