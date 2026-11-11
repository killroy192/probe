// @effect-diagnostics nodeBuiltinImport:off - Makes a folder fixture and a process that outlives a shell.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import * as Effect from "effect/Effect";

import { frameHolder, type PointerPage } from "../browser.ts";
import { connectApi } from "../lib/api.ts";
import { SELFTEST_SHORT_MS, seconds } from "../lib/deadlines.ts";
import { layoutSaved, layoutState } from "../lib/navigate.ts";
import { setUp } from "../lib/setup.ts";
import { history, shellEnded, followShells } from "../lib/shells.ts";
import { startShell } from "../lib/ui/plusModal.ts";
import { closeTab } from "../lib/ui/tabs.ts";
import { shellReady, typeLine } from "../lib/ui/terminal.ts";
import { check, recorder, waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

const SHORT = seconds(SELFTEST_SHORT_MS);

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
  const rpc = await connectApi(server, shown);
  const shells = followShells(rpc.client);
  await setUp(shown, [plain], name);
  return { page: shown, rpc, shells, plain, name };
}

export const typingWaitFails = defineCheck(import.meta.url, {
  id: "T7",
  title: "typing into a shell that never becomes ready fails naming it, and types nothing",
  needs: { restart: true },
  run: async (context) => {
    // An unwrapped shell never prints the prompt mark, so its tab never says ready.
    await context.server.restart({ env: { SHELL: "/bin/sh" } });
    const { page, rpc, shells, plain } = await workspacePage(context);
    try {
      const never = await startShell(page, shells, plain);
      await context.trail.stage("type into a shell that is never ready", async () => {
        const message = await failure(
          "Typing into a shell that is never ready",
          typeLine(page, "echo typed-t7", { deadline: SELFTEST_SHORT_MS }),
        );
        check(
          message.includes(never.shellId) &&
            message.includes("ready: starting") &&
            message.includes(SHORT),
          `The typing wait's failure does not name the shell, its states and the deadline: ${message}`,
        );
        check(
          !(await history(rpc.client, never.shellId)).includes("typed-t7"),
          "The typing wait typed into a shell that was not ready.",
        );
      });

      // A shell that ends while the wait runs fails it at once, not at its deadline.
      await context.trail.stage("wait for a shell that ends", async () => {
        const ending = shellReady(page, never.shellId);
        NodeProcess.kill(never.pid!, "SIGKILL");
        const ended = await failure("Waiting for a shell that ends", ending);
        check(
          ended.includes(never.shellId) && ended.includes("ended"),
          `The wait for a shell that ended does not say so: ${ended}`,
        );
      });
    } finally {
      await rpc.close();
    }
  },
});

export const layoutWaitFails = defineCheck(import.meta.url, {
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
      await context.trail.stage("wait for a held layout save", async () => {
        holder.hold('"workspace.saveTabs"');
        await closeTab(page, shell.shellId);
        await layoutState(page, "pending").waitFor();
        const message = await failure(
          "Waiting for a held layout save",
          layoutSaved(page, name, { deadline: SELFTEST_SHORT_MS }),
        );
        check(
          message.includes(name) && message.includes("pending") && message.includes(SHORT),
          `The layout wait's failure does not name the workspace, its state and the deadline: ${message}`,
        );
        holder.release();
      });
    } finally {
      await rpc.close();
    }
  },
});

export const endCheckFails = defineCheck(import.meta.url, {
  id: "T9",
  title: "a process still running after its shell's end event fails the check at once",
  needs: {},
  run: async (context) => {
    const { page, rpc, shells, plain } = await workspacePage(context);
    // Stands in for a shell process that outlived its end event.
    const survivor = NodeChildProcess.spawn("sleep", ["60"], { stdio: "ignore" });
    try {
      const shell = await startShell(page, shells, plain);
      await context.trail.stage("check a process that outlived its shell's end", async () => {
        await Effect.runPromise(rpc.client["shell.kill"]({ shellId: shell.shellId }));
        const message = await failure(
          "The end check of a process that still runs",
          shellEnded(shells, { shellId: shell.shellId, pid: survivor.pid! }),
        );
        check(
          message.includes(shell.shellId) && message.includes(String(survivor.pid)),
          `The end check's failure does not name the shell and pid: ${message}`,
        );
      });
    } finally {
      survivor.kill("SIGKILL");
      await rpc.close();
    }
  },
});

export const waitFailuresNamed = defineCheck(import.meta.url, {
  id: "T14",
  title: "a wait whose event never comes fails naming what it awaited, its offset and the deadline",
  needs: {},
  run: async ({ openPage }) => {
    const values = recorder<string>("t14 values");
    values.push("before");
    const from = values.mark();
    values.push("after-1");
    values.push("after-2");
    const recorded = await failure(
      "Waiting for a value that never comes",
      values.until("the value never-t14", (value) => value === "never-t14", from, {
        deadline: SELFTEST_SHORT_MS,
      }),
    );
    check(
      recorded.includes("the value never-t14") &&
        recorded.includes("t14 values") &&
        recorded.includes(`offset ${from}`) &&
        recorded.includes("2 values seen since") &&
        recorded.includes(SHORT),
      `The recorder wait's failure does not name what, its recorder, offset, count and deadline: ${recorded}`,
    );

    const page = await openPage();
    const located = await failure(
      "Waiting for an element that never shows",
      waitFor(page.getByTestId("never-t14"), "the element never-t14", {
        deadline: SELFTEST_SHORT_MS,
      }),
    );
    check(
      located.includes("the element never-t14") && located.includes(SHORT),
      `The page wait's failure does not name what it awaited and the deadline: ${located}`,
    );
  },
});
