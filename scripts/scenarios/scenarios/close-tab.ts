import { expected } from "../lib/expect.ts";
import { history, printedAfter, running, writeLine } from "../lib/shells.ts";
import { plainTabs } from "../lib/setup.ts";
import { closeTab, tabIds } from "../lib/ui/tabs.ts";
import { shellPanel, shellReady } from "../lib/ui/terminal.ts";
import { openFromTree, shellRow } from "../lib/ui/tree.ts";
import { waitFor } from "../lib/waits.ts";
import { type CheckScenario, defineCheck } from "../scenario.ts";

const twoOpenTabs = async (ctx: Parameters<typeof plainTabs>[0]) => {
  const made = await plainTabs(ctx, 2);
  const [first, second] = made.shells as [
    (typeof made.shells)[number],
    (typeof made.shells)[number],
  ];
  return { ...made, first, second };
};

export const closeTabCheck = defineCheck(import.meta.url, {
  id: "S5.close-tab",
  title: "closing a tab hides its terminal while the shell runs on in the tree",
  needs: {},
  covers: ["S5 AC-3"],
  returns: "closedTabShell",
  run: async (ctx) => {
    const { page, shown, setup, first, second } = await ctx.trail.stage("setup", () =>
      twoOpenTabs(ctx),
    );

    await ctx.trail.stage("AC-3", async () => {
      await closeTab(page, first.shellId);
      await waitFor(shellPanel(page, first.shellId), `the terminal of shell ${first.shellId}`, {
        state: "detached",
      });
      expected({ what: "the open tabs", expected: [second.shellId], found: await tabIds(page) });
      expected({
        what: `shell ${first.shellId}, whose tab was closed, running`,
        expected: true,
        found: running(setup.shells, first.shellId),
      });
      await waitFor(shellRow(page, first.shellId), `the tree row of shell ${first.shellId}`);
    });

    return { kind: "closedTabShell", shell: first, shown };
  },
});

export const outputWhileClosed = defineCheck(import.meta.url, {
  id: "S5.output-while-closed",
  title: "output a shell makes while its tab is closed shows when the tab reopens",
  needs: {},
  covers: ["S5 AC-6"],
  run: async (ctx) => {
    const made = await ctx.trail.stage("setup", () => twoOpenTabs(ctx));
    const { page, frames, setup, first } = made;

    await ctx.trail.stage("AC-6", async () => {
      await writeLine(setup.client, setup.shells, first.shellId, "read word; echo after-$word-s5");
      await closeTab(page, first.shellId);
      // The page may keep its attach while the tab is closed and send no new snapshot on reopen,
      // and the terminal draws no DOM text, so the output counts from before it was made.
      const madeFrom = frames.mark();
      await printedAfter(setup, first.shellId, "go", "after-go-s5");
      expected({
        what: `the output made while the tab was closed in the history of ${first.shellId}`,
        expected: true,
        found: (await history(setup.client, first.shellId)).includes("after-go-s5"),
      });
      await openFromTree(page, first.shellId);
      await shellReady(page, first.shellId);
      await frames.until(
        "the output made while the tab was closed, on the page",
        (frame) => frame.includes("after-go-s5"),
        madeFrom,
      );
    });
  },
});

export const reopenFromTree = defineCheck(import.meta.url, {
  id: "S5.reopen-from-tree",
  title: "selecting a shell in the tree opens its tab again with the running shell",
  needs: {},
  covers: ["S5 AC-4"],
  run: async (ctx) => {
    const made = await ctx.trail.stage("setup", () => twoOpenTabs(ctx));
    const { page, setup, first } = made;

    await ctx.trail.stage("AC-4", async () => {
      // The criterion is the tab and the running shell. The terminal draws no DOM text, and a
      // quick reopen may keep the page's attach, so no frame can show what the reopened tab draws.
      await closeTab(page, first.shellId);
      await openFromTree(page, first.shellId);
      await shellReady(page, first.shellId);
      expected({
        what: `shell ${first.shellId} running after its tab reopened`,
        expected: true,
        found: running(setup.shells, first.shellId),
      });
    });
  },
});

export const closeAll = defineCheck(import.meta.url, {
  id: "S5.close-all",
  title: "closing every tab leaves no terminal and no error while the shells stay listed",
  needs: {},
  covers: ["S5 AC-5"],
  run: async (ctx) => {
    const { page, setup, first, second } = await ctx.trail.stage("setup", () => twoOpenTabs(ctx));

    await ctx.trail.stage("AC-5", async () => {
      await closeTab(page, first.shellId);
      await closeTab(page, second.shellId);
      await waitFor(page.getByText("No open shells"), "the empty tab strip's notice");
      expected({ what: "the open tabs", expected: [], found: await tabIds(page) });
      expected({
        what: "alerts after closing every tab",
        expected: 0,
        found: await page.getByRole("alert").count(),
      });
      for (const shell of [first, second]) {
        expected({
          what: `shell ${shell.shellId}, whose tab was closed, running`,
          expected: true,
          found: running(setup.shells, shell.shellId),
        });
        await waitFor(shellRow(page, shell.shellId), `the tree row of shell ${shell.shellId}`);
      }
    });
  },
});

export const successors: ReadonlyArray<CheckScenario> = [
  closeTabCheck,
  outputWhileClosed,
  reopenFromTree,
  closeAll,
];
