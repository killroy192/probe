// @effect-diagnostics nodeBuiltinImport:off globalRandom:off - Holds lock files and probes local ports directly, from a random start.

import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { processStartTime } from "./cleanup.ts";

/**
 * Harness servers listen on a leased port. The range is below the Linux (32768–60999) and macOS
 * (49152–65535) ephemeral ranges, where port 0 and outgoing connections take ports, and clear of
 * the dev runner's 5733–8733 and 13773–16773.
 */
export const PORT_RANGE = { first: 20_000, last: 31_999 } as const;

/** One `<port>.json` per lease, holding its owner's pid and start time. */
export const PORTS_DIR = NodePath.join(NodeOS.tmpdir(), "probe-scenario-ports");

/** How often a server start moves to a new port after a foreign process took the leased one. */
export const MAX_PORT_RESTARTS = 3;

export const portTakenLine = (taken: number, next: number) =>
  `scenarios: port ${taken} was taken by another process; using ${next}`;

export interface PortLease {
  readonly port: number;
  /** Removes the lock file, only while it is still this process's. */
  readonly release: () => void;
}

interface Owner {
  readonly pid: number;
  readonly startTime: string;
}

const HOST = "127.0.0.1";

const readOwner = (path: string): Owner | null => {
  try {
    const owner = JSON.parse(NodeFS.readFileSync(path, "utf8")) as Partial<Owner>;
    return typeof owner.pid === "number" && typeof owner.startTime === "string"
      ? { pid: owner.pid, startTime: owner.startTime }
      : null;
  } catch {
    return null;
  }
};

const sameOwner = (a: Owner | null, b: Owner) =>
  a !== null && a.pid === b.pid && a.startTime === b.startTime;

const createExclusive = (path: string, owner: Owner) => {
  try {
    NodeFS.writeFileSync(path, JSON.stringify(owner), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};

/**
 * Takes `<port>.json` for `owner`. A lock whose owner is dead is taken over; an unreadable one is
 * treated as held, since it may be mid-write.
 */
function tryLock(dir: string, port: number, owner: Owner): boolean {
  const path = NodePath.join(dir, `${port}.json`);
  if (createExclusive(path, owner)) return true;
  const holder = readOwner(path);
  if (holder === null || processStartTime(holder.pid) === holder.startTime) return false;
  // Two processes may see the same dead owner; the take-over lock makes one of them re-read and
  // delete, so a lock just taken by the other is never removed.
  const takeover = NodePath.join(dir, `${port}.takeover`);
  if (!createExclusive(takeover, owner)) return false;
  try {
    if (!sameOwner(readOwner(path), holder)) return false;
    NodeFS.rmSync(path, { force: true });
    return createExclusive(path, owner);
  } finally {
    NodeFS.rmSync(takeover, { force: true });
  }
}

/** Whether nothing listens on the port on loopback now. */
export const canBind = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = NodeNet.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: HOST, exclusive: true }, () => server.close(() => resolve(true)));
  });

/**
 * Leases a port in `range` that no other harness process holds and that binds now. The scan starts
 * at a random port, so parallel workers rarely contend. The lease lasts until `release`, across
 * server restarts.
 */
export async function leasePort({
  dir = PORTS_DIR,
  range = PORT_RANGE,
}: {
  readonly dir?: string;
  readonly range?: { readonly first: number; readonly last: number };
} = {}): Promise<PortLease> {
  NodeFS.mkdirSync(dir, { recursive: true });
  const owner: Owner = {
    pid: NodeProcess.pid,
    startTime: processStartTime(NodeProcess.pid) ?? "",
  };
  const size = range.last - range.first + 1;
  const start = Math.floor(Math.random() * size);
  for (let offset = 0; offset < size; offset++) {
    const port = range.first + ((start + offset) % size);
    if (!tryLock(dir, port, owner)) continue;
    const path = NodePath.join(dir, `${port}.json`);
    const release = () => {
      if (sameOwner(readOwner(path), owner)) NodeFS.rmSync(path, { force: true });
    };
    if (await canBind(port)) return { port, release };
    release();
  }
  throw new Error(
    `No free port in ${range.first}–${range.last}: every one is leased under ${dir} or in use.`,
  );
}

/** Whether a start failed because another process listens on its port. */
const portTaken = (error: unknown) =>
  error instanceof Error && error.message.includes("EADDRINUSE");

/**
 * Runs `start` on a leased port. When a foreign process took that port first, the start moves to
 * a newly leased one, at most `MAX_PORT_RESTARTS` times, each move printed with `portTakenLine`.
 * The lease that served is returned; every other one is released.
 */
export async function startOnLeasedPort<T>(
  start: (port: number) => Promise<T>,
  {
    lease = () => leasePort(),
    note,
  }: {
    readonly lease?: () => Promise<PortLease>;
    readonly note: (line: string) => void;
  },
): Promise<{ readonly value: T; readonly lease: PortLease }> {
  let current = await lease();
  for (let restarts = 0; ; restarts++) {
    let failure: unknown;
    try {
      return { value: await start(current.port), lease: current };
    } catch (error) {
      failure = error;
    }
    if (!portTaken(failure) || restarts === MAX_PORT_RESTARTS) {
      current.release();
      throw failure;
    }
    const taken = current;
    try {
      current = await lease();
    } finally {
      taken.release();
    }
    note(portTakenLine(taken.port, current.port));
  }
}
