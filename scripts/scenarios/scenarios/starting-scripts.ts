// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Makes folder fixtures in the throwaway home, edits its starting scripts and times the start.

import * as NodeFSP from "node:fs/promises";

import type { StartingScript } from "@t3tools/contracts";

import { readStartingScripts, startingScriptsFile, writeStartingScripts } from "../lib/files.ts";
import { restartAndReload, showWorkspace } from "../lib/navigate.ts";
import { pageFrames } from "../lib/network.ts";
import { metric } from "../lib/report.ts";
import { expectLogged, logEntries, serverPromptMs } from "../lib/serverLog.ts";
import { setupOn } from "../lib/setup.ts";
import {
  agentTypedOnceAfterPrompt,
  history,
  MOCK_AGENT_LINES,
  PROMPT_MARK,
  shellsIn,
  stripOsc,
} from "../lib/shells.ts";
import { dialog } from "../lib/ui/dialog.ts";
import {
  cancelModal,
  expectOnlyPlain,
  openModal,
  pickItem,
  pickScript,
  scriptDropdown,
  scriptItems,
  selectedScriptKey,
  startButton,
  startFromModal,
} from "../lib/ui/plusModal.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { openFromTree, shellNodes, shellRow } from "../lib/ui/tree.ts";
import { check } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";
import { MOCK_AGENT_COMMAND, type ServerHandle } from "../server.ts";

/** The prompt mark as it shows in a page frame's JSON text. */
const FRAME_PROMPT_MARK = JSON.stringify(PROMPT_MARK).slice(1, -1);

const count = (text: string, part: string) => text.split(part).length - 1;

/** The server's start log lines. */
const startLines = (server: ServerHandle) =>
  logEntries(server).filter((line) => line.includes("shell started"));

export const plainShell: Scenario = {
  id: "E2-S3",
  title: "start a plain shell from the plus modal",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, openPage, trail } = ctx;
    const page = await openPage();
    const frames = pageFrames(page);
    let setup = await setupOn(ctx, { as: page });
    const made = await setup.repo({ linkedWorktree: true });
    const linked = made.linked[0]?.path;
    check(linked !== undefined, "The repository has no linked worktree.");
    const ws = await setup.workspace("plain-shell");
    const repo = (await setup.project(ws, made)).path;
    await showWorkspace(page, ws);

    await trail.stage("AC-1", async () => {
      await openModal(page, repo, { script: null });
      check(await scriptDropdown(page).isEnabled(), "The Starting script dropdown is disabled.");
      const offered = await scriptItems(page);
      check(
        JSON.stringify(offered) === JSON.stringify(["Plain shell", "mock agent"]),
        `A fresh state folder offers ${JSON.stringify(offered)} (AC-1).`,
      );
    });

    // Timed like the baseline: the first start on a fresh server, in the project's checkout. The
    // times are recorded, not judged (FR-4); the 700 ms budget is checked by a serial perf run.
    await trail.stage("AC-2b", async () => {
      check((await selectedScriptKey(page)) === "plain", "Plain shell is not preselected.");
      const from = frames.mark();
      // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
      const clickedAt = Date.now();
      await startButton(page).click();
      await frames.until("the first prompt", (frame) => frame.includes(FRAME_PROMPT_MARK), from);
      // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- temporary: PRB.T-039 moves this metric into a perf scenario
      metric("E2-S3", "click-to-prompt", Date.now() - clickedAt, "harness, includes the browser");
      await dialog(page).waitFor({ state: "detached" });
      const [timed] = await shellsIn(setup.shells.lists, repo, 1);
      check(timed !== undefined, "The plain shell is not listed.");
      metric(
        "E2-S3",
        "start-to-prompt",
        await serverPromptMs(server, timed.shellId),
        "server, start request to first prompt",
      );
    });

    // AC-13a: the variable that used to set every shell's command has no effect any more.
    await trail.stage("AC-2a, AC-13a", async () => {
      setup = await restartAndReload(ctx, page, ws, setup, {
        PROBE_AGENT_COMMAND: MOCK_AGENT_COMMAND,
      });
      await openModal(page, repo, { script: "Plain shell" });
      await pickItem(page, "Start in", linked);
      check((await startFromModal(page)) === null, "The plain start in the worktree failed.");
      const [shell] = await shellsIn(setup.shells.lists, linked, 1);
      check(shell !== undefined && shell.worktree === linked, "The shell is not in the worktree.");
      await shellRow(page, shell.shellId).waitFor();
      const startedFrom = frames.mark();
      // A line typed now runs after anything the server typed, so its output closes the check.
      await typeLine(page, "echo plain-$((40+2))");
      await frames.nothingSince(
        "the mock agent in a plain shell (AC-2a, AC-13a)",
        (frame) => frame.includes("mock-agent") || frame.includes("Mock Agent"),
        startedFrom,
        { what: "the typed line's output", match: (frame) => frame.includes("plain-42") },
      );
      const shown = stripOsc(await history(setup.client, shell.shellId));
      check(
        !shown.includes("mock-agent") && !shown.includes("Mock Agent"),
        `Something was typed into a plain shell: ${JSON.stringify(shown.slice(0, 400))} (AC-2a, AC-13a).`,
      );
      await expectLogged(
        server,
        `The plain start is not logged as plain (AC-12): ${startLines(server).join("\n")}`,
        (line) =>
          line.includes("shell started") &&
          line.includes(shell.shellId) &&
          /script\W+plain/.test(line),
      );
    });
  },
};

export const userScripts: Scenario = {
  id: "E2-S1",
  title: "start a user starting script and find it preselected after a restart",
  needs: { restart: true },
  run: async (ctx) => {
    const { server, openPage, trail } = ctx;
    const page = await openPage();
    const output = pageFrames(page);
    let setup = await setupOn(ctx, { as: page });
    const echo: StartingScript = {
      id: "echo",
      name: "echo agent",
      command: "echo probe-$((40+2))",
    };
    // AC-4, AC-21: a second command line, an entry with no name, a repeated name.
    const [mock] = await readStartingScripts(server.home);
    check(mock?.name === "mock agent", "The harness state folder has no mock agent (AC-1).");
    await writeStartingScripts(server.home, [
      mock,
      echo,
      { id: "unnamed", name: "", command: "printf x" },
      { id: "echo-again", name: "echo agent", command: "echo again" },
    ]);
    const ws = await setup.workspace("user-scripts");
    const repo = (await setup.project(ws, await setup.repo())).path;
    const plain = (await setup.project(ws, await setup.folder("plain"))).path;
    await showWorkspace(page, ws);

    await trail.stage("AC-21", async () => {
      await openModal(page, repo, { script: null });
      const offered = await scriptItems(page);
      check(
        JSON.stringify(offered) ===
          JSON.stringify(["Plain shell", "mock agent", "echo agent", "printf", "echo agent"]),
        `The modal offers ${JSON.stringify(offered)} (AC-21).`,
      );
    });

    const agent = await trail.stage("AC-3", async () => {
      await cancelModal(page);
      await openModal(page, repo);
      const agentFrom = output.mark();
      check((await startFromModal(page)) === null, "The mock agent start failed (AC-3).");
      const [started] = await shellsIn(setup.shells.lists, repo, 1);
      check(started !== undefined, "The mock agent shell did not start.");
      await output.until(
        "the mock agent's session line",
        (frame) => frame.includes(MOCK_AGENT_LINES.session),
        agentFrom,
      );
      const agentRaw = server.rawOutput(started.shellId);
      const problem = agentTypedOnceAfterPrompt(agentRaw, MOCK_AGENT_COMMAND, MOCK_AGENT_LINES);
      check(
        problem === null,
        `The mock agent did not start exactly once, after the prompt (AC-3): ${problem}: ${JSON.stringify(agentRaw.slice(0, 400))}`,
      );
      return started;
    });

    const echoed = await trail.stage("AC-4", async () => {
      await openModal(page, plain, { script: "echo agent" });
      const echoFrom = output.mark();
      check((await startFromModal(page)) === null, "The echo script start failed (AC-4).");
      const [started] = await shellsIn(setup.shells.lists, plain, 1);
      check(started !== undefined, "The echo shell did not start.");
      await output.until(
        "the echo script's output",
        (frame) => frame.includes("probe-42"),
        echoFrom,
      );
      const echoShown = stripOsc(await history(setup.client, started.shellId));
      check(
        count(echoShown, "probe-42") === 1,
        `The second script did not run once after the prompt (AC-4): ${JSON.stringify(echoShown.slice(0, 400))}`,
      );
      return started;
    });

    await trail.stage("AC-12", async () => {
      for (const [shellId, name] of [
        [agent.shellId, "mock agent"],
        [echoed.shellId, "echo agent"],
      ] as const) {
        await expectLogged(
          server,
          "A start line lacks the script name (AC-12).",
          (line) => line.includes("shell started") && line.includes(shellId) && line.includes(name),
        );
      }
      const started = startLines(server);
      check(
        started.every((line) => !line.includes("mock-agent.ts") && !line.includes("probe-$")),
        "A start line carries the command line (AC-12).",
      );
    });

    await trail.stage("AC-5", async () => {
      const listBefore = await NodeFSP.readFile(startingScriptsFile(server.home), "utf8");
      await openModal(page, repo, { script: null });
      check(
        (await selectedScriptKey(page)) === mock.id,
        "The mock agent is not preselected (AC-5).",
      );
      await cancelModal(page);
      setup = await restartAndReload(ctx, page, ws, setup);
      for (const [project, id] of [
        [repo, mock.id],
        [plain, "echo"],
      ] as const) {
        await openModal(page, project, { script: null });
        const key = await selectedScriptKey(page);
        check(key === id, `${project} preselects ${key}, not ${id}, after a restart (AC-5).`);
        await cancelModal(page);
      }
      check(
        (await NodeFSP.readFile(startingScriptsFile(server.home), "utf8")) === listBefore,
        "The user list changed across the restart (AC-5).",
      );
    });

    await trail.stage("AC-22", async () => {
      await writeStartingScripts(server.home, [mock, { ...echo, name: "renamed" }]);
      await openModal(page, plain, { script: null });
      check(
        (await selectedScriptKey(page)) === "echo",
        "A renamed script is not preselected (AC-22).",
      );
      await cancelModal(page);
    });

    await trail.stage("AC-7", async () => {
      await writeStartingScripts(server.home, [mock]);
      await openModal(page, plain, { script: null });
      check(
        (await selectedScriptKey(page)) === "plain",
        "A removed script is still preselected (AC-7).",
      );
      check(
        (await dialog(page).getByRole("alert").count()) === 0,
        "A removed script shows an error (AC-7).",
      );
      await cancelModal(page);
    });

    await trail.stage("AC-23", async () => {
      await writeStartingScripts(server.home, []);
      setup = await restartAndReload(ctx, page, ws, setup);
      await expectOnlyPlain(page, repo, "An emptied list was seeded again (AC-23).");
      check(
        (await readStartingScripts(server.home)).length === 0,
        "The emptied list file changed on restart (AC-23).",
      );
    });

    await trail.stage("AC-9", async () => {
      await NodeFSP.writeFile(startingScriptsFile(server.home), "{ damaged");
      setup = await restartAndReload(ctx, page, ws, setup);
      await expectOnlyPlain(page, repo, "A damaged list offers more than Plain shell (AC-9).");
      await expectLogged(server, "The damaged list is not in the server log (AC-9).", (line) =>
        line.includes("the starting scripts could not be read"),
      );
      check(
        (await NodeFSP.readFile(startingScriptsFile(server.home), "utf8")) === "{ damaged",
        "The damaged list file was overwritten (AC-9).",
      );
    });

    await trail.stage("AC-8", async () => {
      await NodeFSP.rm(startingScriptsFile(server.home));
      setup = await restartAndReload(ctx, page, ws, setup, { PROBE_SEED_MOCK_AGENT: undefined });
      await expectOnlyPlain(page, repo, "A start without the default offers scripts (AC-8).");
      check(
        !(await NodeFSP.stat(startingScriptsFile(server.home)).catch(() => null)),
        "A start without the default wrote a list (AC-8).",
      );
      // With the default on again, a state folder with no list gets the mock agent (AC-23).
      setup = await restartAndReload(ctx, page, ws, setup);
      check(
        (await readStartingScripts(server.home)).map((script) => script.name).join() ===
          "mock agent",
        "A state folder with no list was not given the mock agent (AC-23).",
      );
    });
  },
};

export const startFailures: Scenario = {
  id: "E2-S4",
  title: "a missing program is named and an exiting command keeps the shell",
  needs: {
    unshared:
      "it rewrites the server's starting-script list and expects no other shell on the server",
  },
  run: async (ctx) => {
    const { server, openPage, trail } = ctx;
    const page = await openPage();
    const output = pageFrames(page);
    const setup = await setupOn(ctx, { as: page });
    const shells = setup.shells;
    const [mock] = await readStartingScripts(server.home);
    check(mock !== undefined, "The harness state folder has no mock agent.");
    await writeStartingScripts(server.home, [
      mock,
      { id: "missing", name: "missing agent", command: "TOKEN=secret missing-cli --flag" },
      { id: "quick", name: "quick exit", command: "sh -c 'echo quick-exit; exit 3'" },
    ]);
    const ws = await setup.workspace("start-failures");
    const repo = (await setup.project(ws, await setup.repo())).path;
    await showWorkspace(page, ws);

    // AC-1, AC-12: every step below is a click; the alert names the program only.
    await trail.stage("AC-1", async () => {
      await openModal(page, repo, { script: "missing agent" });
      await startButton(page).click();
      const alert = await dialog(page).getByRole("alert").textContent();
      check(
        alert?.includes("missing-cli") === true &&
          !alert.includes("--flag") &&
          !alert.includes("TOKEN"),
        `The alert does not name only the program: ${alert} (AC-1).`,
      );
    });

    // The shell is listed while it starts; the refusal removes it.
    await trail.stage("AC-2", async () => {
      await shellNodes(page).first().waitFor({ state: "detached" });
      await shells.lists.until(
        "the refused shell to go",
        (list) => list.length === 0,
        Math.max(0, shells.lists.seen.length - 1),
      );
      check(
        shells.current().length === 0 && (await shellNodes(page).count()) === 0,
        "A refused start left a shell or a tree node (AC-2).",
      );
    });

    await trail.stage("AC-5", async () => {
      const logLines = logEntries(server);
      check(
        logLines.some(
          (line) =>
            line.includes("shell failed to start") &&
            line.includes("missing agent") &&
            line.includes("missing-cli") &&
            line.includes(repo),
        ),
        "The log has no refusal line with the script, the program and the folder (AC-5).",
      );
      check(
        logLines.every((line) => !line.includes("TOKEN=") && !line.includes("--flag")),
        "A log line carries an env assignment or an argument of the command line (AC-5).",
      );
    });

    // AC-4: the modal stays open for another try.
    const plain = await trail.stage("AC-4", async () => {
      await pickScript(page, "Plain shell");
      check((await startFromModal(page)) === null, "The start after the refusal failed (AC-4).");
      const [started] = await shellsIn(shells.lists, repo, 1);
      check(started?.status === "running", "Plain shell did not start after the refusal (AC-4).");
      return started;
    });

    // AC-9 to AC-11: the command ends with code 3; its shell stays listed and running.
    const quick = await trail.stage("AC-9", async () => {
      const quickFrom = output.mark();
      await openModal(page, repo, { script: "quick exit" });
      check((await startFromModal(page)) === null, "The quick exit start failed (AC-9).");
      const started = await shellsIn(shells.lists, repo, 2);
      const found = started.find((shell) => shell.shellId !== plain.shellId);
      check(found !== undefined, "The quick exit shell is not listed (AC-9).");
      await shellRow(page, found.shellId).waitFor();
      await openFromTree(page, found.shellId);
      await output.until(
        "the quick command's output",
        (frame) => frame.includes("quick-exit"),
        quickFrom,
      );
      return found;
    });

    await trail.stage("AC-10", async () => {
      const typedFrom = output.mark();
      await typeLine(page, "echo typed-$((40+2))");
      await output.until(
        "the typed line's output",
        (frame) => frame.includes("typed-42"),
        typedFrom,
      );
      const after = shells.current().find((shell) => shell.shellId === quick.shellId);
      check(
        after?.status === "running" && after.ended === null,
        `The shell is ${after?.status ?? "gone"} after its command exited (AC-9, AC-11).`,
      );
      await shellRow(page, quick.shellId).waitFor();
    });
  },
};
