import { showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn } from "../lib/setup.ts";
import { MOCK_AGENT_LINES } from "../lib/shells.ts";
import { openModal, startButton } from "../lib/ui/plusModal.ts";
import { definePerf } from "../scenario.ts";

export const startToBannerPerf = definePerf(import.meta.url, {
  id: "perf-start-to-banner",
  title: "the agent's banner shows after a start from the plus modal",
  needs: {},
  measure: { name: "click-to-banner", limitMs: 2000, limitFrom: "PRB.E-001 NFR-1" },
  run: async (ctx) => {
    const page = await ctx.openPage();
    const frames = pageFrames(page);
    const setup = await setupOn(ctx, { as: page });
    const ws = await setup.workspace("perf-banner");
    const repo = (await setup.project(ws, await setup.repo())).path;
    await showWorkspace(page, ws);
    await openModal(page, repo);
    const from = frames.mark();

    const clickedAt = performance.now();
    await startButton(page).click();
    await frames.until(
      "the mock CLI banner",
      (frame) => frame.includes(MOCK_AGENT_LINES.banner),
      from,
    );
    return performance.now() - clickedAt;
  },
});
