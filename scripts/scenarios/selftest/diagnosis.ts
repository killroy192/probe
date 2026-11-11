// @effect-diagnostics nodeBuiltinImport:off - SIGKILLs its own server, as a crash would end it.

import * as NodeProcess from "node:process";

import { SELFTEST_SHORT_MS } from "../lib/deadlines.ts";
import { expected } from "../lib/expect.ts";
import { setupOn, world } from "../lib/setup.ts";
import { followOutput, history, stripOsc, writeLine } from "../lib/shells.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";

/** Fails on purpose: the tree shows the workspace's one project, and the check expects two. */
export const wrongUiState = defineCheck(import.meta.url, {
  id: "T18",
  title: "a wrong UI state",
  needs: {},
  run: async (ctx) => {
    const made = await ctx.trail.stage("show a workspace with one folder", () =>
      world(ctx, { projects: [{ kind: "folder", label: "t18" }], page: true }),
    );
    const page = made.shown!.page;
    const tree = page.getByRole("tree");
    await ctx.trail.stage("count the projects in the tree", async () => {
      const folder = made.projects[0]!.path;
      await waitFor(tree.locator(`[data-project="${folder}"]`), `the tree row of ${folder}`);
      expected({
        what: `projects the tree shows for ${made.workspace.name}`,
        expected: 2,
        found: await tree.locator("[data-project]").count(),
      });
    });
  },
});

/** Fails on purpose: a shell prints `t19-42`, and the check waits for `t19-43`. */
export const outputNeverComes = defineCheck(import.meta.url, {
  id: "T19",
  title: "terminal output that never comes",
  needs: {},
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const shell = await ctx.trail.stage("start a plain shell", async () => {
      const ws = await setup.workspace("t19");
      return setup.shell(await setup.project(ws, await setup.folder()));
    });
    ctx.onStepEnd(`shell ${shell.shellId}`, () => setup.killShell(shell));
    const viewer = followOutput(setup.client, shell.shellId);
    ctx.onStepEnd(`the output of shell ${shell.shellId}`, viewer.stop);
    await ctx.trail.stage("wait for a line the shell never prints", async () => {
      const want = "t19-43";
      await writeLine(setup.client, setup.shells, shell.shellId, "echo t19-$((6*7))");
      const missing = await viewer.output
        .until(`the line ${want} in shell ${shell.shellId}`, (event) => event.includes(want), 0, {
          deadline: SELFTEST_SHORT_MS,
        })
        .then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      if (missing === null) return;
      const lines = stripOsc(await history(setup.client, shell.shellId))
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line !== "");
      expected({ what: missing, expected: want, found: lines.slice(-3).join(" | ") });
    });
  },
});

/** Fails on purpose: it SIGKILLs its own server mid-stage, so the run blames the stage on the exit. */
export const serverKilled = defineCheck(import.meta.url, {
  id: "T20",
  title: "a server that crashes mid-stage",
  needs: { serverWide: "kills its server" },
  run: async (ctx) => {
    const page = await ctx.trail.stage("open a page", async () => {
      const opened = await ctx.openPage();
      await waitFor(opened.getByTestId("workspace-screen"), "the start screen");
      return opened;
    });
    await ctx.trail.stage("kill the server mid-stage", async () => {
      NodeProcess.kill(ctx.server.pid(), "SIGKILL");
      await waitFor(
        page.getByText("a text no page shows"),
        "a text no page shows, while the server is gone",
      );
    });
  },
});
