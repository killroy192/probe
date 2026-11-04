// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Checks the shell's pid and makes a workspace in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ShellSummary, TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { PointerPage } from "../browser.ts";
import { connectRpc, environmentId, type WsClient } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";

const WAIT_MS = 20_000;

/** Values seen so far, and a wait for the first one (from `from` on) that matches. */
function recorder<A>() {
  const seen: Array<A> = [];
  const waiters = new Set<() => void>();
  return {
    seen,
    push: (value: A) => {
      seen.push(value);
      for (const wake of waiters) wake();
    },
    until: (what: string, match: (value: A) => boolean, from = 0) =>
      new Promise<A>((resolve, reject) => {
        const check = () => {
          const found = seen.slice(from).find(match);
          if (found === undefined) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`Timed out waiting for ${what}.`));
        }, WAIT_MS);
        waiters.add(check);
        check();
      }),
  };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Ending a shell sends SIGTERM and escalates after a grace period, so the process leaves a little later.
async function gone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

const follow = <A, E>(stream: Stream.Stream<A, E>, onValue: (value: A) => void) =>
  Effect.runFork(Stream.runForEach(stream, (value) => Effect.sync(() => onValue(value))));

/** Text the page received over its websockets, which is what its canvas terminal draws. */
function pageFrames(page: PointerPage) {
  const frames = recorder<string>();
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") frames.push(payload);
    }),
  );
  return frames;
}

async function openShell(client: WsClient, cwd: string): Promise<ShellSummary> {
  return Effect.runPromise(client["shell.open"]({ cwd, cols: 80, rows: 24 }));
}

export const standaloneShell: Scenario = {
  id: "T-002",
  title: "standalone shell without a chat thread",
  run: async ({ server, openPage }) => {
    const workspace = NodePath.join(server.home, "workspace");
    await NodeFSP.mkdir(workspace);
    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const frames = pageFrames(page);
    const environment = await environmentId(server.origin);
    const rpc = await connectRpc(server.origin, page);
    const { client } = rpc;

    try {
      const shells = recorder<ReadonlyArray<ShellSummary>>();
      let list: ReadonlyArray<ShellSummary> = [];
      follow(client.subscribeShells({}), (event) => {
        if (event.type === "snapshot") list = event.shells;
        else if (event.type === "remove")
          list = list.filter((shell) => shell.shellId !== event.shellId);
        else list = [...list.filter((shell) => shell.shellId !== event.shell.shellId), event.shell];
        shells.push(list);
      });

      // AC-1, AC-3: a shell with no chat thread, listed with its id, folder and status.
      const shell = await openShell(client, workspace);
      if (shell.status !== "running" || shell.pid === null) {
        throw new Error(`The shell did not start: ${JSON.stringify(shell)}`);
      }
      await shells.until("the shell in the list", (current) =>
        current.some(
          (listed) =>
            listed.shellId === shell.shellId &&
            listed.cwd === workspace &&
            listed.status === "running",
        ),
      );

      const output = recorder<TerminalAttachStreamEvent>();
      const text = () =>
        output.seen
          .flatMap((event) =>
            event.type === "output"
              ? [event.data]
              : event.type === "snapshot"
                ? [event.snapshot.history]
                : [],
          )
          .join("");
      follow(client["shell.attach"]({ shellId: shell.shellId }), output.push);
      const waitForText = (what: string, match: RegExp) =>
        output.until(what, () => match.test(text()));

      await Effect.runPromise(
        client["shell.write"]({ shellId: shell.shellId, data: "echo before-$((40+2))\r" }),
      );
      await waitForText("output written before the page opened", /before-42/);

      // AC-15 (automated part): the shell opens in the terminal view by its identity.
      await page.goto(`${server.origin}/shell/${environment}/${shell.shellId}`);
      await page.getByTestId("shell-view").locator("canvas").waitFor();
      await frames.until("earlier output in the page", (frame) => frame.includes("before-42"));

      // AC-16: the shell's size follows the pane. The page reports its grid once it has attached.
      await output.until(
        "the page's grid",
        (event) => event.type === "activity" && event.cols !== undefined && event.cols !== 80,
      );
      const sizeAfter = async (marker: string) => {
        await Effect.runPromise(
          client["shell.write"]({ shellId: shell.shellId, data: `echo ${marker}:$(stty size)\r` }),
        );
        const match = new RegExp(`${marker}:(\\d+) (\\d+)`);
        await waitForText(`${marker} size`, match);
        const [, rows, cols] = match.exec(text())!;
        return { rows: Number(rows), cols: Number(cols) };
      };
      const wide = await sizeAfter("wide");
      if (wide.cols === 80 && wide.rows === 24) {
        throw new Error("The page did not resize the shell to its pane.");
      }
      const resizedFrom = output.seen.length;
      await page.setViewportSize({ width: 700, height: 500 });
      await output.until(
        "a narrower grid",
        (event) => event.type === "activity" && event.cols !== undefined && event.cols < wide.cols,
        resizedFrom,
      );
      const narrow = await sizeAfter("narrow");
      if (narrow.cols >= wide.cols || narrow.rows >= wide.rows) {
        throw new Error(`The shell kept ${JSON.stringify(wide)} after the pane shrank.`);
      }

      // AC-5: a reload reattaches and shows the earlier output again.
      const reloadedFrom = frames.seen.length;
      await page.reload();
      await page.getByTestId("shell-view").locator("canvas").waitFor();
      await frames.until(
        "earlier output after reload",
        (frame) => frame.includes("before-42"),
        reloadedFrom,
      );
      if (!alive(shell.pid)) throw new Error("The shell ended when the page reloaded.");

      // AC-7: ending a shell removes it and its process.
      await Effect.runPromise(client["shell.close"]({ shellId: shell.shellId }));
      await shells.until("the closed shell to leave the list", (current) =>
        current.every((listed) => listed.shellId !== shell.shellId),
      );
      if (!(await gone(shell.pid))) throw new Error(`Shell process ${shell.pid} is still running.`);

      // A-14 as the spike recorded it: a server restart ends shells (story 7 changes this).
      const survivor = await openShell(client, workspace);
      await rpc.close();
      await server.restart();
      if (survivor.pid !== null && !(await gone(survivor.pid))) {
        throw new Error("A shell survived a server restart; update A-14 and story 7.");
      }
      const after = await connectRpc(server.origin, page);
      try {
        const first = await Effect.runPromise(
          after.client.subscribeShells({}).pipe(Stream.take(1), Stream.runCollect),
        );
        const leftover = first.flatMap((event) => (event.type === "snapshot" ? event.shells : []));
        if (leftover.length > 0) throw new Error("Shells are listed after a server restart.");
      } finally {
        await after.close();
      }
    } finally {
      await rpc.close();
    }
  },
};
