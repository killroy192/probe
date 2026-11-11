import type { PointerPage } from "../browser.ts";
import { gitOk } from "../lib/files.ts";
import { openTab, showWorkspace } from "../lib/navigate.ts";
import { setupOn } from "../lib/setup.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { waitFor } from "../lib/waits.ts";
import { definePerf } from "../scenario.ts";

const worktreeLabel = (page: PointerPage, path: string, text: RegExp) =>
  page
    .locator(`[data-worktree="${path}"]`)
    .getByRole("treeitem", { level: 3 })
    .filter({ hasText: text });

export const branchLabelPerf = definePerf(import.meta.url, {
  id: "perf-branch-label",
  title: "a branch switch in a shell relabels its worktree node",
  needs: {},
  measure: { name: "switch-to-label", limitMs: 2000, limitFrom: "PRB.T-005 AC-26" },
  run: async (ctx) => {
    const page = await ctx.openPage();
    const setup = await setupOn(ctx, { as: page });
    const ws = await setup.workspace("perf-branch-label");
    const made = await setup.repo();
    await gitOk(made.path, "branch", "other");
    const repo = await setup.project(ws, made);
    const shell = await setup.shell(repo);
    await showWorkspace(page, ws);
    await openTab(page, shell);
    await waitFor(worktreeLabel(page, repo.path, /^primary · main$/), "the label primary · main");

    const switchedAt = performance.now();
    await typeLine(page, "git switch -q other");
    await waitFor(worktreeLabel(page, repo.path, /^primary · other$/), "the label primary · other");
    return performance.now() - switchedAt;
  },
});
