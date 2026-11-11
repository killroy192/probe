import { showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn } from "../lib/setup.ts";
import { PROMPT_MARK } from "../lib/shells.ts";
import { openModal, startButton } from "../lib/ui/plusModal.ts";
import { definePerf } from "../scenario.ts";

/** The prompt mark as it shows in a page frame's JSON text. */
const FRAME_PROMPT_MARK = JSON.stringify(PROMPT_MARK).slice(1, -1);

export const promptHarnessPerf = definePerf(import.meta.url, {
  id: "perf-prompt-harness",
  title: "a plain shell's first prompt reaches the page after the click",
  needs: {},
  measure: { name: "click-to-prompt", limitMs: 700, limitFrom: "PRB.E-002" },
  run: async (ctx) => {
    const page = await ctx.openPage();
    const frames = pageFrames(page);
    const setup = await setupOn(ctx, { as: page });
    const ws = await setup.workspace("perf-prompt-harness");
    const repo = (await setup.project(ws, await setup.repo())).path;
    await showWorkspace(page, ws);
    await openModal(page, repo, { script: "Plain shell" });
    const from = frames.mark();

    const clickedAt = performance.now();
    await startButton(page).click();
    await frames.until("the first prompt", (frame) => frame.includes(FRAME_PROMPT_MARK), from);
    return performance.now() - clickedAt;
  },
});
