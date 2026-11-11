import { setupOn } from "../lib/setup.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";

/** Stops its server and shell host with a shell running, then starts the server again. */
export const stopsShellHost = defineCheck(import.meta.url, {
  id: "T36",
  title: "stops its shell host and starts the server again",
  needs: { restart: true },
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    await ctx.trail.stage("start a plain shell", async () => {
      const ws = await setup.workspace("t36");
      await setup.shell(await setup.project(ws, await setup.folder()));
    });
    await ctx.trail.stage("stop the server and its shell host", async () => {
      await setup.close();
      await ctx.server.stop();
      await ctx.server.stopShellHost();
    });
    await ctx.trail.stage("start the server again", async () => {
      await ctx.server.restart();
      const page = await ctx.openPage();
      await waitFor(page.getByTestId("workspace-screen"), "the start screen after the restart");
    });
  },
});
