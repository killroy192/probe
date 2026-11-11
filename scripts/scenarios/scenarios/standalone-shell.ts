import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { environmentId } from "../lib/api.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn } from "../lib/setup.ts";
import { openShell, writeLine } from "../lib/shells.ts";
import { alive, follow, recorder, waitFor } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";

export const standaloneShell: Scenario = {
  id: "T-002",
  title: "standalone shell without a chat thread",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, trail } = ctx;
    const page = await ctx.openPage();
    const frames = pageFrames(page);
    const environment = await environmentId(server.origin);
    const setup = await setupOn(ctx, { as: page });
    const { client, shells } = setup;
    const workspace = (await setup.folder("workspace")).path;
    const shellView = page.getByTestId("shell-view").locator("canvas");

    // AC-1, AC-3: a shell with no chat thread, listed with its id, folder and status.
    const shell = await trail.stage("AC-1", async () => {
      const shell = await openShell(client, workspace);
      if (shell.status !== "running" || shell.pid === null) {
        throw new Error(`The shell did not start: ${JSON.stringify(shell)}`);
      }
      // No earlier list can hold this new shell, so any list counts.
      await shells.lists.until(
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
      return { ...shell, pid: shell.pid };
    });

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

    // AC-15 (automated part): the shell opens in the terminal view by its identity.
    const gridFrom = await trail.stage("AC-15", async () => {
      await writeLine(client, shells, shell.shellId, "echo before-$((40+2))");
      await waitForText("output written before the page opened", /before-42/);
      const openedFrom = frames.mark();
      const gridFrom = output.mark();
      await page.goto(`${server.origin}/shell/${environment}/${shell.shellId}`);
      await waitFor(shellView, "the shell view's terminal");
      await frames.until(
        "earlier output in the page",
        (frame) => frame.includes("before-42"),
        openedFrom,
      );
      return gridFrom;
    });

    // AC-16: the shell's size follows the pane. The page reports its grid once it has attached.
    await trail.stage("AC-16", async () => {
      await output.until(
        "the page's grid",
        (event) => event.type === "activity" && event.cols !== undefined && event.cols !== 80,
        gridFrom,
      );
      const sizeAfter = async (marker: string) => {
        await writeLine(client, shells, shell.shellId, `echo ${marker}:$(stty size)`);
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
    });

    // AC-5: a reload reattaches and shows the earlier output again.
    await trail.stage("AC-5", async () => {
      const reloadedFrom = frames.mark();
      await page.reload();
      await waitFor(shellView, "the shell view's terminal after the reload");
      await frames.until(
        "earlier output after reload",
        (frame) => frame.includes("before-42"),
        reloadedFrom,
      );
      if (!alive(shell.pid)) throw new Error("The shell ended when the page reloaded.");
    });

    // AC-7: ending a shell removes it and its process.
    await trail.stage("AC-7", async () => {
      const killedFrom = shells.lists.mark();
      await Effect.runPromise(client["shell.kill"]({ shellId: shell.shellId }));
      await shells.lists.until(
        "the closed shell to leave the list",
        (current) => current.every((listed) => listed.shellId !== shell.shellId),
        killedFrom,
      );
      // The server removes a killed shell only once its process ended, so one check is enough.
      if (alive(shell.pid))
        throw new Error(`Shell process ${shell.pid} still runs after its removal.`);
    });

    // A-14 (PRB.T-007): a server restart leaves a running shell running, and lists it again.
    await trail.stage("A-14", async () => {
      const survivor = await openShell(client, workspace);
      await setup.close();
      await server.restart();
      if (survivor.pid === null || !alive(survivor.pid)) {
        throw new Error("A running shell ended with the server restart.");
      }
      const after = await setupOn(ctx, { as: page });
      // A fresh subscription: its first list is the server's state after the restart.
      const listed = await after.shells.lists.until(
        "the shell list after the restart",
        () => true,
        0,
      );
      const back = listed.find((entry) => entry.shellId === survivor.shellId);
      if (back?.status !== "running" || back.pid !== survivor.pid) {
        throw new Error(`The shell is not back as the same process: ${JSON.stringify(back)}.`);
      }
    });
  },
};
