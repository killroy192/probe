// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Checks the shell's pid and makes a workspace in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ShellSummary, TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectRpc, environmentId, type WsClient } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { alive, follow, pageFrames, recorder } from "../support.ts";

async function openShell(client: WsClient, cwd: string): Promise<ShellSummary> {
  return Effect.runPromise(client["shell.open"]({ cwd, cols: 80, rows: 24 }));
}

export const standaloneShell: Scenario = {
  id: "T-002",
  title: "standalone shell without a chat thread",
  needs: { restart: true },
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
      // No earlier list can hold this new shell, so any list counts.
      await shells.until(
        "the shell in the list",
        (current) =>
          current.some(
            (listed) =>
              listed.shellId === shell.shellId &&
              listed.cwd === workspace &&
              listed.status === "running",
          ),
        0,
      );

      const output = recorder<TerminalAttachStreamEvent>("attach events");
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
      // Judges all the text so far, so each wait looks for a marker that is written only once.
      const waitForText = (what: string, match: RegExp) =>
        output.until(what, () => match.test(text()), 0);

      await Effect.runPromise(
        client["shell.write"]({ shellId: shell.shellId, data: "echo before-$((40+2))\r" }),
      );
      await waitForText("output written before the page opened", /before-42/);

      // AC-15 (automated part): the shell opens in the terminal view by its identity.
      const openedFrom = frames.mark();
      const gridFrom = output.mark();
      await page.goto(`${server.origin}/shell/${environment}/${shell.shellId}`);
      await page.getByTestId("shell-view").locator("canvas").waitFor();
      await frames.until(
        "earlier output in the page",
        (frame) => frame.includes("before-42"),
        openedFrom,
      );

      // AC-16: the shell's size follows the pane. The page reports its grid once it has attached.
      await output.until(
        "the page's grid",
        (event) => event.type === "activity" && event.cols !== undefined && event.cols !== 80,
        gridFrom,
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
      const resizedFrom = output.mark();
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
      const reloadedFrom = frames.mark();
      await page.reload();
      await page.getByTestId("shell-view").locator("canvas").waitFor();
      await frames.until(
        "earlier output after reload",
        (frame) => frame.includes("before-42"),
        reloadedFrom,
      );
      if (!alive(shell.pid)) throw new Error("The shell ended when the page reloaded.");

      // AC-7: ending a shell removes it and its process.
      const killedFrom = shells.mark();
      await Effect.runPromise(client["shell.kill"]({ shellId: shell.shellId }));
      await shells.until(
        "the closed shell to leave the list",
        (current) => current.every((listed) => listed.shellId !== shell.shellId),
        killedFrom,
      );
      // The server removes a killed shell only once its process ended, so one check is enough.
      if (alive(shell.pid))
        throw new Error(`Shell process ${shell.pid} still runs after its removal.`);

      // A-14 (PRB.T-007): a server restart leaves a running shell running, and lists it again.
      const survivor = await openShell(client, workspace);
      await rpc.close();
      await server.restart();
      if (survivor.pid === null || !alive(survivor.pid)) {
        throw new Error("A running shell ended with the server restart.");
      }
      const after = await connectRpc(server.origin, page);
      try {
        const first = await Effect.runPromise(
          after.client.subscribeShells({}).pipe(Stream.take(1), Stream.runCollect),
        );
        const listed = first.flatMap((event) => (event.type === "snapshot" ? event.shells : []));
        const back = listed.find((entry) => entry.shellId === survivor.shellId);
        if (back?.status !== "running" || back.pid !== survivor.pid) {
          throw new Error(`The shell is not back as the same process: ${JSON.stringify(back)}.`);
        }
      } finally {
        await after.close();
      }
    } finally {
      await rpc.close();
    }
  },
};
