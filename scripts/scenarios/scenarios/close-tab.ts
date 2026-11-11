import { openTab, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { setupOn } from "../lib/setup.ts";
import { followOutput, history, running, writeLine } from "../lib/shells.ts";
import { closeTab, shellTab, tabs } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { openFromTree, shellRow } from "../lib/ui/tree.ts";
import { check, waitFor } from "../lib/waits.ts";
import { defineCheck } from "../scenario.ts";

export const closeTabScenario = defineCheck(import.meta.url, {
  id: "S5",
  title: "close a tab and reopen it from the tree",
  needs: {},
  covers: ["S5 AC-3", "S5 AC-4", "S5 AC-5", "S5 AC-6"],
  run: async (ctx) => {
    const { trail } = ctx;
    const page = await ctx.openPage();
    const frames = pageFrames(page);
    const setup = await setupOn(ctx, { as: page });
    const { client, shells } = setup;

    const { first, second } = await trail.stage("setup", async () => {
      const ws = await setup.workspace("s5");
      const plain = await setup.project(ws, await setup.folder("plain"));
      const first = await setup.shell(plain);
      const second = await setup.shell(plain);
      await showWorkspace(page, ws);
      await openTab(page, first);
      await openTab(page, second);
      return { first, second };
    });

    // AC-6 (setup): the first shell waits for a line, then prints after its tab is closed.

    await trail.stage("AC-6 setup", async () => {
      await openTab(page, first);
      await typeLine(page, "read word; echo after-$word-s5");
    });

    // AC-3: closing a tab hides its terminal; the shell runs on and stays in the tree.

    await trail.stage("AC-3", async () => {
      await closeTab(page, first.shellId);
      check((await tabs(page).count()) === 1, "Closing one tab closed others (AC-3).");
      check(running(shells, first.shellId), "Closing the tab ended the shell (AC-3).");
      await waitFor(shellRow(page, first.shellId), `the tree row of shell ${first.shellId}`);
      check(
        (await page.getByRole("tabpanel", { name: /./ }).count()) === 1,
        "The closed shell's terminal is still shown (AC-3).",
      );
    });

    // AC-6: output made while the tab is closed shows when it reopens.

    const before = await trail.stage("AC-6", async () => {
      // The scenario's own viewer sees the output arrive; the page has no viewer for it now.
      const { output, stop } = followOutput(client, first.shellId);
      ctx.onStepEnd("the scenario's viewer", stop);
      // The first event of a fresh attach is its snapshot.
      await output.until("the scenario's attach snapshot", () => true, 0);
      // The page may keep receiving a closed tab's output, or get it as history on reopen.
      const before = frames.mark();
      const written = output.mark();
      await writeLine(client, shells, first.shellId, "go");
      await output.until(
        "the closed shell's output",
        (event) => event.includes("after-go-s5"),
        written,
      );
      check(
        (await history(client, first.shellId)).includes("after-go-s5"),
        "The closed shell's history lacks its output (AC-6).",
      );
      return before;
    });

    // AC-4: selecting the shell in the tree opens its tab again with the running shell.

    await trail.stage("AC-4", async () => {
      await openFromTree(page, first.shellId);
      await frames.until(
        "the reopened tab's history",
        (frame) => frame.includes("after-go-s5"),
        before,
      );
      check(running(shells, first.shellId), "The reopened shell is not running (AC-4).");
    });

    // AC-5: closing every tab leaves no terminal and no error; the shells stay listed.

    await trail.stage("AC-5", async () => {
      await closeTab(page, first.shellId);
      await closeTab(page, second.shellId);
      await waitFor(page.getByText("No open shells"), "the empty tab strip's notice");
      check((await page.getByRole("alert").count()) === 0, "Closing every tab showed an error.");
      check(
        running(shells, first.shellId) && running(shells, second.shellId),
        "Closing every tab ended a shell (AC-5).",
      );
      for (const shell of [first, second]) {
        await waitFor(shellRow(page, shell.shellId), `the tree row of shell ${shell.shellId}`);
      }
      check((await shellTab(page, first.shellId).count()) === 0, "A closed tab is still shown.");
    });
  },
});
