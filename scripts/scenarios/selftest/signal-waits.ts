// @effect-diagnostics nodeBuiltinImport:off - Makes a folder fixture and a process that outlives a shell.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import * as Effect from "effect/Effect";

import { frameHolder, type PointerPage } from "../browser.ts";
import { setUp } from "../fixtures.ts";
import { connectRpc } from "../rpc.ts";
import type { Scenario, ScenarioContext } from "../scenario.ts";
import { check } from "../support.ts";
import {
  closeTab,
  history,
  layoutSaved,
  layoutState,
  shellEnded,
  shellList,
  shellReady,
  startShell,
  typeLine,
} from "../scenarios/workspaceUi.ts";

/** A wait that must fail fast in a self-test, so the self-test does not take the page timeout. */
const SHORT_MS = 2_000;

/** The message of `wait`'s failure; fails the self-test when `wait` succeeds. */
async function failure(what: string, wait: Promise<unknown>): Promise<string> {
  const outcome = await wait.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  check(outcome !== null, `${what} succeeded; it must fail.`);
  return outcome;
}

/** A page with one workspace named by the run, holding one folder, and the server's shell list. */
async function workspacePage({ server, openPage, runId }: ScenarioContext, page?: PointerPage) {
  const name = `sparta-${runId}`;
  const plain = NodePath.join(server.home, "folders", runId, "plain");
  await NodeFSP.mkdir(plain, { recursive: true });
  const shown = page ?? (await openPage());
  const rpc = await connectRpc(server.origin, shown);
  const shells = shellList(rpc.client);
  await setUp(shown, [plain], name);
  return { page: shown, rpc, shells, plain, name };
}

export const typingWaitFails: Scenario = {
  id: "T7",
  title: "typing into a shell that never becomes ready fails naming it, and types nothing",
  needs: { restart: true },
  run: async (context) => {
    // An unwrapped shell never prints the prompt mark, so its tab never says ready.
    await context.server.restart({ env: { SHELL: "/bin/sh" } });
    const { page, rpc, shells, plain } = await workspacePage(context);
    try {
      const never = await startShell(page, shells, plain);
      const message = await failure(
        "Typing into a shell that is never ready",
        typeLine(page, "echo typed-t7", { timeout: SHORT_MS }),
      );
      check(
        message.includes(never.shellId) && message.includes("ready: starting"),
        `The typing wait's failure does not name the shell and its states: ${message}`,
      );
      check(
        !(await history(rpc.client, never.shellId)).includes("typed-t7"),
        "The typing wait typed into a shell that was not ready.",
      );

      // A shell that ends while the wait runs fails it at once, not at its (long) deadline.
      const ending = shellReady(page, never.shellId, { timeout: 60_000 });
      NodeProcess.kill(never.pid!, "SIGKILL");
      const ended = await failure("Waiting for a shell that ends", ending);
      check(
        ended.includes(never.shellId) && ended.includes("ended"),
        `The wait for a shell that ended does not say so: ${ended}`,
      );
    } finally {
      await rpc.close();
    }
  },
};

export const layoutWaitFails: Scenario = {
  id: "T8",
  title: "waiting for a layout save that never comes fails naming the workspace and its state",
  needs: {},
  run: async (context) => {
    const page = await context.openPage();
    const holder = await frameHolder(page);
    // The route applies from the next load on; the page opened already connected.
    await page.reload();
    await page.getByTestId("workspace-screen").waitFor();
    const { rpc, shells, plain, name } = await workspacePage(context, page);
    try {
      const shell = await startShell(page, shells, plain);
      await layoutSaved(page, name);
      holder.hold('"workspace.saveTabs"');
      await closeTab(page, shell.shellId);
      await layoutState(page, "pending").waitFor();
      const message = await failure(
        "Waiting for a held layout save",
        layoutSaved(page, name, { timeout: SHORT_MS }),
      );
      check(
        message.includes(name) && message.includes("pending"),
        `The layout wait's failure does not name the workspace and its state: ${message}`,
      );
      holder.release();
    } finally {
      await rpc.close();
    }
  },
};

export const endCheckFails: Scenario = {
  id: "T9",
  title: "a process still running after its shell's end event fails the check at once",
  needs: {},
  run: async (context) => {
    const { page, rpc, shells, plain } = await workspacePage(context);
    // Stands in for a shell process that outlived its end event.
    const survivor = NodeChildProcess.spawn("sleep", ["60"], { stdio: "ignore" });
    try {
      const shell = await startShell(page, shells, plain);
      await Effect.runPromise(rpc.client["shell.kill"]({ shellId: shell.shellId }));
      const message = await failure(
        "The end check of a process that still runs",
        shellEnded(shells, { shellId: shell.shellId, pid: survivor.pid! }),
      );
      check(
        message.includes(shell.shellId) && message.includes(String(survivor.pid)),
        `The end check's failure does not name the shell and pid: ${message}`,
      );
    } finally {
      survivor.kill("SIGKILL");
      await rpc.close();
    }
  },
};
