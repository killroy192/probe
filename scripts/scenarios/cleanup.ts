// @effect-diagnostics nodeBuiltinImport:off - Records and stops the processes a scenario run started.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

/**
 * A run writes what it started into `<tmp>/probe-scenario-runs/<runner pid>.json`, so a run killed
 * with SIGKILL can be cleaned up by the next one. Only these recorded pids, and pids written into
 * the run's own throwaway homes, are ever stopped; nothing is matched by name or path.
 */
export const RUNS_DIR = NodePath.join(NodeOS.tmpdir(), "probe-scenario-runs");

export interface ManifestEntry {
  readonly kind: "server";
  readonly pid: number;
  readonly startTime: string;
  readonly home: string;
  /** When the home was made; a process found through the home must not be older. */
  readonly homeCreatedMs: number;
}

/** What a sandbox records about itself, so a run can find its server by the sandbox's pid. */
export interface SandboxRecord {
  readonly origin: string;
  readonly home: string;
  readonly serverPid: number;
  /** Where the sandbox writes its server's output, for a run's log waits and failure artifacts. */
  readonly logFile: string;
  /** Before the sandbox looked at its sources; a source newer than this needs a new sandbox. */
  readonly startedMs: number;
  /** The bundle the server serves; another time on `dist/index.html` means it was rebuilt since. */
  readonly bundleBuiltMs: number | null;
  /** Written before the sandbox ends its server, so a run on it ends at once. */
  readonly stopping?: true;
}

export interface ProcessIdentity {
  readonly pid: number;
  readonly startTime: string;
}

export interface Manifest {
  readonly runner: ProcessIdentity;
  /** The launcher of the run this process belongs to; a worker outliving it is abandoned. */
  readonly run?: ProcessIdentity;
  readonly entries: ReadonlyArray<ManifestEntry>;
  readonly sandbox?: SandboxRecord;
}

/** The sandbox's server output file, next to its manifest and removed with it. */
export const sandboxLogFile = (pid: number, dir = RUNS_DIR) => NodePath.join(dir, `${pid}.log`);
/** Held by the one scenario run a sandbox runs at a time. */
const sandboxLockFile = (pid: number, dir = RUNS_DIR) => NodePath.join(dir, `${pid}.lock`);

/** Removes what a runner kept beside its manifest. */
function removeSideFiles(pid: number, dir: string) {
  NodeFS.rmSync(sandboxLogFile(pid, dir), { force: true });
  NodeFS.rmSync(sandboxLockFile(pid, dir), { force: true });
}

/** The process's start, as the OS reports it; null when no such process runs. */
export function processStartTime(pid: number): string | null {
  try {
    if (NodeProcess.platform === "linux") {
      const stat = NodeFS.readFileSync(`/proc/${pid}/stat`, "utf8");
      // Field 22 (starttime); the fields after the parenthesized name start at field 3.
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
    }
    const started = NodeChildProcess.execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    return started === "" ? null : started;
  } catch {
    return null;
  }
}

let linuxClock: { readonly bootMs: number; readonly ticksPerSecond: number } | null | undefined;
const linuxBootClock = () => {
  if (linuxClock !== undefined) return linuxClock;
  try {
    const btime = /^btime (\d+)$/m.exec(NodeFS.readFileSync("/proc/stat", "utf8"))?.[1];
    const ticksPerSecond = Number(
      NodeChildProcess.execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
    );
    linuxClock = btime === undefined ? null : { bootMs: Number(btime) * 1000, ticksPerSecond };
  } catch {
    linuxClock = null;
  }
  return linuxClock;
};

/** Milliseconds since the epoch the process started, for comparing with a home's creation. */
function processStartMs(pid: number): number | null {
  if (NodeProcess.platform === "linux") {
    const ticks = Number(processStartTime(pid));
    const clock = linuxBootClock();
    if (!Number.isFinite(ticks) || clock === null) return null;
    return clock.bootMs + (ticks / clock.ticksPerSecond) * 1000;
  }
  const started = processStartTime(pid);
  return started === null ? null : Date.parse(started);
}

/** The process `pid` is the one recorded with `startTime`, so a reused pid is never stopped. */
const isSameProcess = (pid: number, startTime: string) => processStartTime(pid) === startTime;

function writeManifest(path: string, manifest: Manifest) {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  NodeFS.writeFileSync(temporary, JSON.stringify(manifest));
  NodeFS.renameSync(temporary, path);
}

/** This run's manifest; `add` on start, `remove` once stopped, `close` when the run ends. */
export function openManifest(dir = RUNS_DIR, run?: ProcessIdentity) {
  const path = NodePath.join(dir, `${NodeProcess.pid}.json`);
  const runner = { pid: NodeProcess.pid, startTime: processStartTime(NodeProcess.pid) ?? "" };
  let entries: Array<ManifestEntry> = [];
  let sandbox: SandboxRecord | undefined;
  const save = () =>
    writeManifest(path, {
      runner,
      ...(run ? { run } : {}),
      entries,
      ...(sandbox ? { sandbox } : {}),
    });
  save();
  return {
    describeSandbox: (record: SandboxRecord) => {
      sandbox = record;
      save();
    },
    markSandboxStopping: () => {
      if (sandbox === undefined) return;
      sandbox = { ...sandbox, stopping: true };
      save();
    },
    add: (entry: ManifestEntry) => {
      entries = [...entries.filter((known) => known.pid !== entry.pid), entry];
      save();
    },
    remove: (pid: number) => {
      entries = entries.filter((known) => known.pid !== pid);
      save();
    },
    close: () => {
      NodeFS.rmSync(path, { force: true });
      removeSideFiles(runner.pid, dir);
    },
  };
}

/**
 * The live sandbox whose own pid is `pid`, from the harness's record; a reason when there is none.
 * A sandbox is never found by an address, only by the manifest its process wrote, and only one on
 * loopback with a throwaway home counts.
 */
export function findSandbox(
  pid: number,
  dir = RUNS_DIR,
  homeDirectory = NodeOS.homedir(),
): { readonly sandbox: SandboxRecord } | { readonly refusal: string } {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      NodeFS.readFileSync(NodePath.join(dir, `${pid}.json`), "utf8"),
    ) as Manifest;
  } catch {
    return { refusal: `No sandbox this harness started has the pid ${pid}.` };
  }
  const { sandbox } = manifest;
  if (sandbox === undefined) {
    return { refusal: `Process ${pid} is a scenario run, not a sandbox.` };
  }
  if (!isSameProcess(manifest.runner.pid, manifest.runner.startTime)) {
    return { refusal: `The sandbox ${pid} is no longer running; start a new one.` };
  }
  if (new URL(sandbox.origin).hostname !== "127.0.0.1") {
    return {
      refusal: `The sandbox ${pid} records ${sandbox.origin}; scenarios only run on loopback.`,
    };
  }
  const home = NodePath.resolve(sandbox.home);
  if (isUnder(home, NodePath.join(homeDirectory, ".t3")) || !isUnder(home, NodeOS.tmpdir())) {
    return {
      refusal: `The sandbox ${pid} records the home ${sandbox.home}; scenarios only use a throwaway home.`,
    };
  }
  return { sandbox };
}

/** True once the sandbox is stopping or gone: it marks its record before it ends its server. */
export function sandboxEnded(pid: number, dir = RUNS_DIR): boolean {
  const found = findSandbox(pid, dir);
  return (
    "refusal" in found ||
    found.sandbox.stopping === true ||
    processStartTime(found.sandbox.serverPid) === null ||
    !NodeFS.existsSync(found.sandbox.home)
  );
}

const isUnder = (child: string, parent: string) => {
  const relative = NodePath.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
};

/**
 * Takes the sandbox's run lock for this process; a reason when a live run holds it. A lock whose
 * owner is gone (a killed run) is taken over.
 */
export function lockSandbox(
  sandboxPid: number,
  dir = RUNS_DIR,
): { readonly release: () => void } | { readonly refusal: string } {
  const path = sandboxLockFile(sandboxPid, dir);
  const owner = { pid: NodeProcess.pid, startTime: processStartTime(NodeProcess.pid) ?? "" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      NodeFS.writeFileSync(path, JSON.stringify(owner), { flag: "wx" });
      return { release: () => NodeFS.rmSync(path, { force: true }) };
    } catch {
      let holder: { readonly pid?: unknown; readonly startTime?: unknown } = {};
      try {
        holder = JSON.parse(NodeFS.readFileSync(path, "utf8")) as typeof holder;
      } catch {
        // Unreadable: a lock being written right now, or a broken one; treated as held.
        return {
          refusal: `One scenario runs at a time on a sandbox; sandbox ${sandboxPid} is busy.`,
        };
      }
      if (
        typeof holder.pid === "number" &&
        typeof holder.startTime === "string" &&
        isSameProcess(holder.pid, holder.startTime)
      ) {
        return {
          refusal: `One scenario runs at a time on a sandbox; run ${holder.pid} is running on sandbox ${sandboxPid}.`,
        };
      }
      NodeFS.rmSync(path, { force: true });
    }
  }
  return { refusal: `Could not take the run lock of sandbox ${sandboxPid}.` };
}

function readNumber(file: string): number | null {
  try {
    const value = Number(NodeFS.readFileSync(file, "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The processes whose parent is `pid`, from the process table by parent pid, never by name. */
export function childPids(pid: number): ReadonlyArray<number> {
  try {
    return NodeChildProcess.execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([, parent]) => parent === pid)
      .map(([child]) => child!);
  } catch {
    return [];
  }
}

/**
 * The home's shell host, from the pid file it wrote, and the shells it runs: its children, plus
 * the shell list, which a runner killed early may not have written yet.
 */
function pidsInHome(home: string): ReadonlyArray<number> {
  const found: Array<number> = [];
  const host = readNumber(NodePath.join(home, "userdata", "shell-host-v1.pid"));
  if (host !== null) found.push(host, ...childPids(host));
  try {
    const registry = JSON.parse(
      NodeFS.readFileSync(NodePath.join(home, "userdata", "shells", "registry.json"), "utf8"),
    ) as { readonly shells?: ReadonlyArray<{ readonly pid?: unknown }> };
    for (const shell of registry.shells ?? []) {
      if (typeof shell.pid === "number" && shell.pid > 0) found.push(shell.pid);
    }
  } catch {
    // No shell list: no shell was saved.
  }
  return [...new Set(found)];
}

const kill = (pid: number, group = false) => {
  try {
    NodeProcess.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

/**
 * Stops what a throwaway server leaves: the server, then its home's shell host and shells (each a
 * PTY session leader, so its whole group), and removes the home. A pid found through the home
 * only counts when its process started after the home was made.
 */
export function killServerTree(entry: ManifestEntry, { keepHome = false } = {}) {
  if (isSameProcess(entry.pid, entry.startTime)) kill(entry.pid);
  for (const pid of pidsInHome(entry.home)) {
    const started = processStartMs(pid);
    // A second of slack for the clock-tick rounding of the start time.
    if (started !== null && started >= entry.homeCreatedMs - 1_000) {
      kill(pid, true);
      kill(pid);
    }
  }
  if (!keepHome) {
    NodeFS.rmSync(entry.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Whether a manifest's processes are left over: its owner is dead, or its owner lives on after the
 * launcher of its run died (a worker of a SIGKILLed launcher), and then the owner is stopped too.
 */
export function abandonment(
  manifest: Pick<Manifest, "runner" | "run">,
  isLive: (process: ProcessIdentity) => boolean,
): "live" | "ownerDead" | "launcherDead" {
  if (!isLive(manifest.runner)) return "ownerDead";
  if (manifest.run !== undefined && !isLive(manifest.run)) return "launcherDead";
  return "live";
}

/** Cleans up after runs that ended without doing it themselves; returns what it printed. */
export function cleanLeftovers(write: (line: string) => void, dir = RUNS_DIR) {
  let names: ReadonlyArray<string> = [];
  try {
    names = NodeFS.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return;
  }
  for (const name of names) {
    const path = NodePath.join(dir, name);
    let manifest: Manifest;
    try {
      manifest = JSON.parse(NodeFS.readFileSync(path, "utf8")) as Manifest;
      if (!Array.isArray(manifest.entries) || typeof manifest.runner?.pid !== "number") {
        throw new Error("not a run manifest");
      }
    } catch (error) {
      write(
        `scenarios: warning: ${path} is unreadable (${error instanceof Error ? error.message : String(error)}); left alone`,
      );
      continue;
    }
    if (manifest.runner.pid === NodeProcess.pid) continue;
    const state = abandonment(manifest, ({ pid, startTime }) => isSameProcess(pid, startTime));
    if (state === "live") continue;
    if (state === "launcherDead") kill(manifest.runner.pid);
    for (const entry of manifest.entries) killServerTree(entry);
    NodeFS.rmSync(path, { force: true });
    removeSideFiles(manifest.runner.pid, dir);
    write(
      state === "launcherDead"
        ? `scenarios: stopped ${manifest.runner.pid}, left running by the ended run ${manifest.run?.pid}, with ${manifest.entries.length} server(s) and their homes`
        : `scenarios: cleaned up after run ${manifest.runner.pid}: ${manifest.entries.length} server(s) and their homes`,
    );
  }
}
