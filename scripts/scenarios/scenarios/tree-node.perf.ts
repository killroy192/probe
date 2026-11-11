import { showWorkspace } from "../lib/navigate.ts";
import { setupOn } from "../lib/setup.ts";
import { openModal, startButton } from "../lib/ui/plusModal.ts";
import { shellNodes } from "../lib/ui/tree.ts";
import { waitFor } from "../lib/waits.ts";
import { definePerf } from "../scenario.ts";

export const treeNodePerf = definePerf(import.meta.url, {
  id: "perf-tree-node",
  title: "a started shell's tree node appears after the click",
  needs: {},
  measure: { name: "click-to-tree-node", limitMs: 1000, limitFrom: "PRB.T-004 AC-3" },
  run: async (ctx) => {
    const page = await ctx.openPage();
    const setup = await setupOn(ctx, { as: page });
    const ws = await setup.workspace("perf-tree-node");
    const repo = (await setup.project(ws, await setup.repo())).path;
    await showWorkspace(page, ws);
    await openModal(page, repo);

    const clickedAt = performance.now();
    await startButton(page).click();
    await waitFor(shellNodes(page, repo).first(), `the tree node of the shell in ${repo}`);
    return performance.now() - clickedAt;
  },
});
