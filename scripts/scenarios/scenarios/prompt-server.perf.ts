import { serverPromptMs } from "../lib/serverLog.ts";
import { setupOn } from "../lib/setup.ts";
import { definePerf } from "../scenario.ts";

export const promptServerPerf = definePerf(import.meta.url, {
  id: "perf-prompt-server",
  title: "the server's time from a plain start request to the first prompt",
  needs: {},
  measure: { name: "start-to-prompt", limitMs: 700 },
  verifies: ["starting-scripts/NFR-1"],
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const ws = await setup.workspace("perf-prompt-server");
    const repo = await setup.project(ws, await setup.repo());
    const shell = await setup.shell(repo);
    return serverPromptMs(ctx.server, shell.shellId);
  },
});
