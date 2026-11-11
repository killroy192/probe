// @effect-diagnostics nodeBuiltinImport:off - SIGKILLs the shared server, as a crash would end it.

import * as NodeProcess from "node:process";

import { waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";

/** Fails on purpose: it SIGKILLs the shared server it runs on, so the run blames the stage on that exit. */
export const sharedServerKilled = defineCheck(import.meta.url, {
  id: "T32",
  title: "the shared server crashes mid-stage",
  // Untrue on purpose: it must run on the shared server it kills; `offSandbox` keeps it off a sandbox.
  needs: {},
  offSandbox: "it SIGKILLs the server it runs on, which every run on the sandbox shares",
  run: async (ctx) => {
    const page = await ctx.trail.stage("open a page", async () => {
      const opened = await ctx.openPage();
      await waitFor(opened.getByTestId("workspace-screen"), "the start screen");
      return opened;
    });
    await ctx.trail.stage("kill the shared server mid-stage", async () => {
      NodeProcess.kill(ctx.server.pid(), "SIGKILL");
      await waitFor(
        page.getByText("a text no page shows"),
        "a text no page shows, while the server is gone",
      );
    });
  },
});
