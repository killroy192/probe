// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Makes folder fixtures in the throwaway home and times the start.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { pageFrames } from "../support.ts";
import {
  addProject,
  check,
  createWorkspace,
  dialog,
  gitOk,
  openModal,
  shellList,
  shellsIn,
  startButton,
} from "./workspaceUi.ts";

/** OSC 133;B, which Probe's zsh and bash wrappers print when the line editor first reads input. */
const PROMPT_MARK = "]133;B";

export const plainShell: Scenario = {
  id: "E2-S3",
  title: "start a plain shell from the plus modal",
  run: async ({ server, openPage }) => {
    const repo = NodePath.join(server.home, "folders", "repo");
    await NodeFSP.mkdir(repo, { recursive: true });
    await gitOk(repo, "init", "-q");
    await gitOk(repo, "commit", "-q", "--allow-empty", "-m", "first");

    const page = await openPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    const frames = pageFrames(page);
    const rpc = await connectRpc(server.origin, page);
    const shells = shellList(rpc.client);
    await createWorkspace(page, "sparta");
    check((await addProject(page, { import: repo })) === null, "Importing the repo failed.");

    // AC-2b: click to first prompt, read from the prompt mark the page receives.
    await openModal(page, repo);
    const from = frames.seen.length;
    const clickedAt = Date.now();
    await startButton(page).click();
    await frames.until("the first prompt", (frame) => frame.includes(PROMPT_MARK), from);
    const promptMs = Date.now() - clickedAt;
    NodeProcess.stdout.write(`scenarios: E2-S3 click-to-prompt ms=${promptMs}\n`);
    await dialog(page).waitFor({ state: "detached" });
    await shellsIn(shells.lists, repo, 1);
  },
};
