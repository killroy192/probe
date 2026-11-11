// @effect-diagnostics nodeBuiltinImport:off - Writes lock files and holds a plain listener.

import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { processStartTime } from "./cleanup.ts";
import { leasePort, type PortLease } from "./ports.ts";

const DEAD = { pid: 2 ** 22 + 1, startTime: "gone" };

const scratch = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scenario-ports-"));

const writeLock = (dir: string, port: number, owner: unknown) =>
  NodeFS.writeFileSync(NodePath.join(dir, `${port}.json`), JSON.stringify(owner));

const readLock = (dir: string, port: number) =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(dir, `${port}.json`), "utf8")) as unknown;

/**
 * Ports leased in the shared lock dir for the whole test, so no other harness process uses them
 * while the test leases them again in its own scratch dir.
 */
async function freePorts(count: number) {
  const leases: Array<PortLease> = [];
  for (let index = 0; index < count; index++) leases.push(await leasePort());
  return {
    ports: leases.map((lease) => lease.port),
    [Symbol.dispose]: () => {
      for (const lease of leases) lease.release();
    },
  };
}

describe("port leases", () => {
  it("never leases a held port twice, and leases it again once released", async () => {
    const dir = scratch();
    using held = await freePorts(1);
    const [port] = held.ports;
    const range = { first: port!, last: port! };
    try {
      const first = await leasePort({ dir, range });
      expect(readLock(dir, first.port)).toEqual({
        pid: process.pid,
        startTime: processStartTime(process.pid),
      });
      await expect(leasePort({ dir, range })).rejects.toThrow(/every one is leased/);
      first.release();
      expect(NodeFS.existsSync(NodePath.join(dir, `${first.port}.json`))).toBe(false);
      const again = await leasePort({ dir, range });
      expect(again.port).toBe(first.port);
      again.release();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes over a lease whose owner is dead, and leaves a live or unreadable one alone", async () => {
    const dir = scratch();
    using held = await freePorts(3);
    const [dead, live, unreadable] = held.ports;
    try {
      writeLock(dir, dead!, DEAD);
      writeLock(dir, live!, { pid: process.ppid, startTime: processStartTime(process.ppid) });
      NodeFS.writeFileSync(NodePath.join(dir, `${unreadable}.json`), "{ half written");
      const leases = [];
      for (const port of [dead!, live!, unreadable!]) {
        const range = { first: port, last: port };
        if (port === dead) leases.push(await leasePort({ dir, range }));
        else await expect(leasePort({ dir, range })).rejects.toThrow(/every one is leased/);
      }
      expect(leases.map((lease) => lease.port)).toEqual([dead]);
      expect(readLock(dir, dead!)).toMatchObject({ pid: process.pid });
      expect(readLock(dir, live!)).toMatchObject({ pid: process.ppid });
      expect(NodeFS.existsSync(NodePath.join(dir, `${dead}.takeover`))).toBe(false);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips a port another process listens on and drops its lock", async () => {
    const dir = scratch();
    using held = await freePorts(1);
    const [port] = held.ports;
    const listener = NodeNet.createServer();
    await new Promise<void>((resolve) => listener.listen(port, "127.0.0.1", resolve));
    try {
      await expect(leasePort({ dir, range: { first: port!, last: port! } })).rejects.toThrow(
        /or in use/,
      );
      expect(NodeFS.existsSync(NodePath.join(dir, `${port}.json`))).toBe(false);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("release leaves a lock that is no longer this process's", async () => {
    const dir = scratch();
    using held = await freePorts(1);
    const [port] = held.ports;
    try {
      const lease = await leasePort({ dir, range: { first: port!, last: port! } });
      writeLock(dir, port!, { pid: process.ppid, startTime: processStartTime(process.ppid) });
      lease.release();
      expect(readLock(dir, port!)).toMatchObject({ pid: process.ppid });
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
