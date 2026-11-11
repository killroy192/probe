// @effect-diagnostics nodeBuiltinImport:off - Makes folder fixtures in the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { alive, check, follow, pageFrames, recorder } from "../support.ts";
import {
  addProject,
  closeTab,
  createWorkspace,
  history,
  leaveAgent,
  openFromTree,
  shellList,
  shellRow,
  shellTab,
  startShell,
  tabs,
  typeLine,
} from "./workspaceUi.ts";

export const closeTabScenario: Scenario = {
  id: "S5",
  title: "close a tab and reopen it from the tree",
  needs: {},
  run: async ({ server, openPage, runId }) => {
    const name = `sparta-${runId}`;
    const plain = NodePath.join(server.home, "folders", runId, "plain");
    await NodeFSP.mkdir(plain, { recursive: true });

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const frames = pageFrames(page);
    const rpc = await connectRpc(server.origin, page);
    const shells = shellList(rpc.client);
    const running = (shellId: string) => {
      const shell = shells.current().find((entry) => entry.shellId === shellId);
      return shell?.status === "running" && shell.pid !== null && alive(shell.pid);
    };
    let stage = "setup";

    try {
      await createWorkspace(page, name);
      check((await addProject(page, { import: plain })) === null, "Adding the folder failed.");
      const first = await startShell(page, shells, plain);
      const second = await startShell(page, shells, plain);

      // AC-6 (setup): the first shell waits for a line, then prints after its tab is closed.

      stage = "AC-6 setup";
      await openFromTree(page, first.shellId);
      await leaveAgent(page, rpc.client, first.shellId);
      await typeLine(page, "read word; echo after-$word-s5");

      // AC-3: closing a tab hides its terminal; the shell runs on and stays in the tree.

      stage = "AC-3";
      await closeTab(page, first.shellId);
      check((await tabs(page).count()) === 1, "Closing one tab closed others (AC-3).");
      check(running(first.shellId), "Closing the tab ended the shell (AC-3).");
      await shellRow(page, first.shellId).waitFor();
      check(
        (await page.getByRole("tabpanel", { name: /./ }).count()) === 1,
        "The closed shell's terminal is still shown (AC-3).",
      );

      // AC-6: output made while the tab is closed shows when it reopens.

      stage = "AC-6";
      // The scenario's own viewer sees the output arrive; the page has no viewer for it now.
      const output = recorder<string>("attach events");
      follow(rpc.client["shell.attach"]({ shellId: first.shellId }), (event) =>
        output.push(JSON.stringify(event)),
      );
      // The first event of a fresh attach is its snapshot.
      await output.until("the scenario's attach snapshot", () => true, 0);
      // The page may keep receiving a closed tab's output, or get it as history on reopen.
      const before = frames.mark();
      const written = output.mark();
      await Effect.runPromise(rpc.client["shell.write"]({ shellId: first.shellId, data: "go\r" }));
      await output.until(
        "the closed shell's output",
        (event) => event.includes("after-go-s5"),
        written,
      );
      check(
        (await history(rpc.client, first.shellId)).includes("after-go-s5"),
        "The closed shell's history lacks its output (AC-6).",
      );

      // AC-4: selecting the shell in the tree opens its tab again with the running shell.

      stage = "AC-4";
      await openFromTree(page, first.shellId);
      await frames.until(
        "the reopened tab's history",
        (frame) => frame.includes("after-go-s5"),
        before,
      );
      check(running(first.shellId), "The reopened shell is not running (AC-4).");

      // AC-5: closing every tab leaves no terminal and no error; the shells stay listed.

      stage = "AC-5";
      await closeTab(page, first.shellId);
      await closeTab(page, second.shellId);
      await page.getByText("No open shells").waitFor();
      check((await page.getByRole("alert").count()) === 0, "Closing every tab showed an error.");
      check(
        running(first.shellId) && running(second.shellId),
        "Closing every tab ended a shell (AC-5).",
      );
      for (const shell of [first, second]) await shellRow(page, shell.shellId).waitFor();
      check((await shellTab(page, first.shellId).count()) === 0, "A closed tab is still shown.");
    } catch (error) {
      throw new Error(`S5 failed at ${stage}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};
