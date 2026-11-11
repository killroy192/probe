import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PointerPage } from "../browser.ts";
import { environmentId } from "../lib/api.ts";
import { expected } from "../lib/expect.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn, type Setup } from "../lib/setup.ts";
import { openShell, writeLine } from "../lib/shells.ts";
import { alive, follow, recorder, waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

/** A standalone shell, outside any workspace, in a folder of this run, once it is listed running. */
async function opened(setup: Setup) {
  const cwd = (await setup.folder("standalone")).path;
  const shell = await openShell(setup.client, cwd);
  expected({
    what: "the opened shell",
    expected: { status: "running", hasPid: true },
    found: { status: shell.status, hasPid: shell.pid !== null },
  });
  // No earlier list can hold this new shell, so any list counts.
  await setup.shells.lists.until(
    `shell ${shell.shellId} in the list as running in ${cwd}`,
    (list) =>
      list.some(
        (listed) =>
          listed.shellId === shell.shellId && listed.cwd === cwd && listed.status === "running",
      ),
    0,
  );
  return { ...shell, pid: shell.pid!, cwd };
}

/** The shell's attach events, and a wait on all its text so far for a marker written once. */
function attached(setup: Setup, shellId: string) {
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
  follow(setup.client["shell.attach"]({ shellId }), output.push);
  const waitForText = (what: string, match: RegExp) =>
    output.until(what, () => match.test(text()), 0);
  return { output, text, waitForText };
}

const shellView = (page: PointerPage) => page.getByTestId("shell-view").locator("canvas");

/**
 * Writes a line before any page shows the shell, then opens the shell view by its identity and
 * waits until the page shows that earlier output.
 */
async function viewed(ctx: ScenarioContext) {
  const page = await ctx.openPage();
  const frames = pageFrames(page);
  const setup = await setupOn(ctx, { as: page });
  const shell = await opened(setup);
  const attach = attached(setup, shell.shellId);
  const marker = `before-${ctx.runId}`;
  await writeLine(setup.client, setup.shells, shell.shellId, `echo ${marker}-$((40+2))`);
  await attach.waitForText("output written before the page opened", new RegExp(`${marker}-42`));
  const openedFrom = frames.mark();
  const gridFrom = attach.output.mark();
  await page.goto(
    `${ctx.server.origin}/shell/${await environmentId(ctx.server.origin)}/${shell.shellId}`,
  );
  await waitFor(shellView(page), "the shell view's terminal");
  await frames.until(
    "earlier output in the page",
    (frame) => frame.includes(`${marker}-42`),
    openedFrom,
  );
  return { page, frames, setup, shell, attach, gridFrom, earlier: `${marker}-42` };
}

export const listed = defineCheck(import.meta.url, {
  id: "T-002.listed",
  title: "a shell opens with no chat thread and is listed with its id, folder and status",
  needs: {},
  // One open proves both: the shell starts outside any thread (AC-1) and is listed (AC-3).
  covers: ["T-002 AC-1", "T-002 AC-3"],
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    await ctx.trail.stage("AC-1", () => opened(setup));
  },
});

export const view = defineCheck(import.meta.url, {
  id: "T-002.view",
  title: "the shell view opens a shell by its identity and sizes it to its pane",
  needs: {},
  // The view that shows the shell (AC-15) is the one whose pane sets its size (AC-16).
  covers: ["T-002 AC-15", "T-002 AC-16"],
  run: async (ctx) => {
    const { page, setup, shell, attach, gridFrom } = await ctx.trail.stage("AC-15", () =>
      viewed(ctx),
    );

    await ctx.trail.stage("AC-16", async () => {
      const { output, text, waitForText } = attach;
      await output.until(
        "the page's grid",
        (event) => event.type === "activity" && event.cols !== undefined && event.cols !== 80,
        gridFrom,
      );
      const sizeAfter = async (label: string) => {
        const marker = `${label}-${ctx.runId}`;
        await writeLine(setup.client, setup.shells, shell.shellId, `echo ${marker}:$(stty size)`);
        const match = new RegExp(`${marker}:(\\d+) (\\d+)`);
        await waitForText(`${marker} size`, match);
        const [, rows, cols] = match.exec(text())!;
        return { rows: Number(rows), cols: Number(cols) };
      };
      const wide = await sizeAfter("wide");
      expected({
        what: "the shell's size once the page shows it",
        expected: "other than 24 rows by 80 columns",
        found:
          wide.rows === 24 && wide.cols === 80
            ? "24 rows by 80 columns"
            : "other than 24 rows by 80 columns",
      });
      const resizedFrom = output.mark();
      await page.setViewportSize({ width: 700, height: 500 });
      await output.until(
        "a narrower grid",
        (event) => event.type === "activity" && event.cols !== undefined && event.cols < wide.cols,
        resizedFrom,
      );
      const narrow = await sizeAfter("narrow");
      expected({
        what: `the shell's size after the pane shrank from ${JSON.stringify(wide)}`,
        expected: { fewerRows: true, fewerCols: true },
        found: { fewerRows: narrow.rows < wide.rows, fewerCols: narrow.cols < wide.cols },
      });
    });
  },
});

export const reload = defineCheck(import.meta.url, {
  id: "T-002.reload",
  title: "a reload of the shell view reattaches and shows the earlier output again",
  needs: {},
  covers: ["T-002 AC-5"],
  run: async (ctx) => {
    const { page, frames, shell, earlier } = await ctx.trail.stage("setup", () => viewed(ctx));

    await ctx.trail.stage("AC-5", async () => {
      const reloadedFrom = frames.mark();
      await page.reload();
      await waitFor(shellView(page), "the shell view's terminal after the reload");
      await frames.until(
        "earlier output after the reload",
        (frame) => frame.includes(earlier),
        reloadedFrom,
      );
      expected({
        what: `shell process ${shell.pid} after the reload`,
        expected: "running",
        found: alive(shell.pid) ? "running" : "ended",
      });
    });
  },
});

export const end = defineCheck(import.meta.url, {
  id: "T-002.end",
  title: "ending a standalone shell removes it and its process",
  needs: {},
  covers: ["T-002 AC-7"],
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const shell = await opened(setup);

    await ctx.trail.stage("AC-7", async () => {
      const killedFrom = setup.shells.lists.mark();
      await Effect.runPromise(setup.client["shell.kill"]({ shellId: shell.shellId }));
      await setup.shells.lists.until(
        `shell ${shell.shellId} to leave the list`,
        (current) => current.every((entry) => entry.shellId !== shell.shellId),
        killedFrom,
      );
      // The server removes a killed shell only once its process ended, so one check is enough.
      expected({
        what: `shell process ${shell.pid} after its removal`,
        expected: "ended",
        found: alive(shell.pid) ? "running" : "ended",
      });
    });
  },
});

export const restart = defineCheck(import.meta.url, {
  id: "T-002.restart",
  title: "a server restart leaves a running standalone shell running and lists it again",
  needs: { restart: true },
  covers: ["T-002 A-14"],
  run: async (ctx) => {
    const page = await ctx.openPage();
    const setup = await setupOn(ctx, { as: page });
    const survivor = await opened(setup);

    await ctx.trail.stage("A-14", async () => {
      await setup.close();
      await ctx.server.restart();
      expected({
        what: `shell process ${survivor.pid} after the restart`,
        expected: "running",
        found: alive(survivor.pid) ? "running" : "ended",
      });
      const after = await setupOn(ctx, { as: page });
      // A fresh subscription: its first list is the server's state after the restart.
      const list = await after.shells.lists.until(
        "the shell list after the restart",
        () => true,
        0,
      );
      const back = list.find((entry) => entry.shellId === survivor.shellId);
      expected({
        what: `shell ${survivor.shellId} in the list after the restart`,
        expected: { status: "running", pid: survivor.pid },
        found: { status: back?.status ?? "absent", pid: back?.pid ?? null },
      });
    });
  },
});

export const successors = [listed, view, reload, end, restart];

// temporary: PRB.T-039 10A removes this alias.
export const standaloneShell = listed;
