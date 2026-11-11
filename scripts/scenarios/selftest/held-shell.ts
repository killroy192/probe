// @effect-diagnostics nodeBuiltinImport:off - Prints its shell's pids for the harness test that stops its run.

import * as NodeProcess from "node:process";

import { setupOn } from "../lib/setup.ts";
import { followOutput } from "../lib/shells.ts";
import { defineCheck } from "../scenario.ts";

/**
 * Starts a shell, prints its pid and its shell host's, then waits for output no shell prints, so a
 * harness test can stop the run, or kill its worker, while a server, a host and a shell run.
 */
export const heldShell = defineCheck(import.meta.url, {
  id: "T35",
  title: "a shell held running until the run is stopped",
  needs: {},
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const shell = await ctx.trail.stage("start a plain shell", async () => {
      const ws = await setup.workspace("t35");
      return setup.shell(await setup.project(ws, await setup.folder()));
    });
    const viewer = followOutput(setup.client, shell.shellId);
    ctx.onStepEnd(`the output of shell ${shell.shellId}`, viewer.stop);
    NodeProcess.stdout.write(
      `scenarios: T35 shell pid=${shell.pid} host=${ctx.server.shellHostPid()}\n`,
    );
    await ctx.trail.stage("wait until the run is stopped", () =>
      viewer.output.until("output no shell prints", () => false, 0),
    );
  },
});
