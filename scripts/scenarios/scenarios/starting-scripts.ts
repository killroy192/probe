// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Makes folder fixtures in the throwaway home, edits its starting scripts and times the start.

import * as NodeFSP from "node:fs/promises";

import type { StartingScript } from "@t3tools/contracts";

import type { PointerPage } from "../browser.ts";
import {
  agentTypedOnceAfterPrompt,
  expectLogged,
  logEntries,
  metric,
  MOCK_AGENT_LINES,
  projects,
  restartAndReload,
  serverPromptMs,
  setUp,
  shellOutput,
} from "../fixtures.ts";
import { connectRpc } from "../rpc.ts";
import type { Scenario } from "../scenario.ts";
import { MOCK_AGENT_COMMAND, type ServerHandle } from "../server.ts";
import { check, pageFrames } from "../support.ts";
import {
  cancelModal,
  dialog,
  history,
  openModal,
  pickItem,
  readStartingScripts,
  reloadShowing,
  scriptDropdown,
  scriptItems,
  shellList,
  shellRow,
  shellsIn,
  startButton,
  startingScriptsFile,
  typeLine,
  writeStartingScripts,
} from "./workspaceUi.ts";

/** OSC 133;B, which Probe's zsh and bash wrappers print when the line editor first reads input. */
const PROMPT_MARK = "]133;B";

const withoutOsc = (text: string) => text.replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "");
const count = (text: string, part: string) => text.split(part).length - 1;

/** The id of the selected starting script ("plain" for Plain shell), once the list has loaded. */
async function selectedScriptKey(page: PointerPage) {
  // Start stays disabled until the dialog has read the list.
  await startButton(page).and(page.locator(":enabled")).waitFor();
  return scriptDropdown(page).locator("[data-key]").getAttribute("data-key");
}

async function startModal(page: PointerPage) {
  await startButton(page).click();
  await dialog(page).waitFor({ state: "detached" });
}

/** The server's start log lines. */
const startLines = (server: ServerHandle) =>
  logEntries(server).filter((line) => line.includes("shell started"));

export const plainShell: Scenario = {
  id: "E2-S3",
  title: "start a plain shell from the plus modal",
  run: async ({ server, openPage }) => {
    const { repo, linked } = await projects(server);
    const page = await openPage();
    const frames = pageFrames(page);
    let rpc = await connectRpc(server.origin, page);
    let shells = shellList(rpc.client);
    let stage = "setup";
    try {
      await setUp(page, [repo]);

      stage = "AC-1";
      await openModal(page, repo, { script: null });
      check(await scriptDropdown(page).isEnabled(), "The Starting script dropdown is disabled.");
      const offered = await scriptItems(page);
      check(
        JSON.stringify(offered) === JSON.stringify(["Plain shell", "mock agent"]),
        `A fresh state folder offers ${JSON.stringify(offered)} (AC-1).`,
      );

      // Timed like the baseline: the first start on a fresh server, in the project's checkout. The
      // times are recorded, not judged (FR-4); the 700 ms budget is checked by a serial perf run.
      stage = "AC-2b";
      check((await selectedScriptKey(page)) === "plain", "Plain shell is not preselected.");
      const from = frames.mark();
      const clickedAt = Date.now();
      await startButton(page).click();
      await frames.until("the first prompt", (frame) => frame.includes(PROMPT_MARK), from);
      metric("E2-S3", "click-to-prompt", Date.now() - clickedAt, "harness, includes the browser");
      await dialog(page).waitFor({ state: "detached" });
      const [timed] = await shellsIn(shells.lists, repo, 1);
      check(timed !== undefined, "The plain shell is not listed.");
      metric(
        "E2-S3",
        "start-to-prompt",
        await serverPromptMs(server, timed.shellId),
        "server, start request to first prompt",
      );

      // AC-13a: the variable that used to set every shell's command has no effect any more.
      stage = "AC-2a, AC-13a";
      await rpc.close();
      await server.restart({ env: { PROBE_AGENT_COMMAND: MOCK_AGENT_COMMAND } });
      await reloadShowing(page, "sparta");
      rpc = await connectRpc(server.origin, page);
      shells = shellList(rpc.client);
      await openModal(page, repo, { script: "Plain shell" });
      await pickItem(page, "Start in", linked);
      await startModal(page);
      const [shell] = await shellsIn(shells.lists, linked, 1);
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
      const shown = withoutOsc(await history(rpc.client, shell.shellId));
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
    } catch (error) {
      throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};

export const userScripts: Scenario = {
  id: "E2-S1",
  title: "start a user starting script and find it preselected after a restart",
  run: async ({ server, openPage }) => {
    const { repo, plain } = await projects(server);
    const page = await openPage();
    const output = pageFrames(page);
    let rpc = await connectRpc(server.origin, page);
    const shells = shellList(rpc.client);
    let stage = "setup";
    const echo: StartingScript = {
      id: "echo",
      name: "echo agent",
      command: "echo probe-$((40+2))",
    };
    try {
      // AC-4, AC-21: a second command line, an entry with no name, a repeated name.
      const [mock] = await readStartingScripts(server.home);
      check(mock?.name === "mock agent", "The harness state folder has no mock agent (AC-1).");
      await writeStartingScripts(server.home, [
        mock,
        echo,
        { id: "unnamed", name: "", command: "printf x" },
        { id: "echo-again", name: "echo agent", command: "echo again" },
      ]);
      await setUp(page, [repo, plain]);

      stage = "AC-21";
      await openModal(page, repo, { script: null });
      const offered = await scriptItems(page);
      check(
        JSON.stringify(offered) ===
          JSON.stringify(["Plain shell", "mock agent", "echo agent", "printf", "echo agent"]),
        `The modal offers ${JSON.stringify(offered)} (AC-21).`,
      );

      stage = "AC-3";
      await cancelModal(page);
      await openModal(page, repo);
      const agentFrom = output.mark();
      await startModal(page);
      const [agent] = await shellsIn(shells.lists, repo, 1);
      check(agent !== undefined, "The mock agent shell did not start.");
      await output.until(
        "the mock agent's session line",
        (frame) => frame.includes("session: mock-"),
        agentFrom,
      );
      const agentRaw = shellOutput(output.seen.slice(agentFrom), agent.shellId);
      const problem = agentTypedOnceAfterPrompt(agentRaw, MOCK_AGENT_COMMAND, MOCK_AGENT_LINES);
      check(
        problem === null,
        `The mock agent did not start exactly once, after the prompt (AC-3): ${problem}: ${JSON.stringify(agentRaw.slice(0, 400))}`,
      );

      stage = "AC-4";
      await openModal(page, plain, { script: "echo agent" });
      const echoFrom = output.mark();
      await startModal(page);
      const [echoed] = await shellsIn(shells.lists, plain, 1);
      check(echoed !== undefined, "The echo shell did not start.");
      await output.until(
        "the echo script's output",
        (frame) => frame.includes("probe-42"),
        echoFrom,
      );
      const echoShown = withoutOsc(await history(rpc.client, echoed.shellId));
      check(
        count(echoShown, "probe-42") === 1,
        `The second script did not run once after the prompt (AC-4): ${JSON.stringify(echoShown.slice(0, 400))}`,
      );

      stage = "AC-12";
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

      stage = "AC-5";
      const listBefore = await NodeFSP.readFile(startingScriptsFile(server.home), "utf8");
      await openModal(page, repo, { script: null });
      check(
        (await selectedScriptKey(page)) === mock.id,
        "The mock agent is not preselected (AC-5).",
      );
      await cancelModal(page);
      rpc = await restartAndReload(page, server, rpc);
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

      stage = "AC-22";
      await writeStartingScripts(server.home, [mock, { ...echo, name: "renamed" }]);
      await openModal(page, plain, { script: null });
      check(
        (await selectedScriptKey(page)) === "echo",
        "A renamed script is not preselected (AC-22).",
      );
      await cancelModal(page);

      stage = "AC-7";
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

      stage = "AC-23";
      await writeStartingScripts(server.home, []);
      rpc = await restartAndReload(page, server, rpc);
      await expectOnlyPlain(page, repo, "An emptied list was seeded again (AC-23).");
      check(
        (await readStartingScripts(server.home)).length === 0,
        "The emptied list file changed on restart (AC-23).",
      );

      stage = "AC-9";
      await NodeFSP.writeFile(startingScriptsFile(server.home), "{ damaged");
      rpc = await restartAndReload(page, server, rpc);
      await expectOnlyPlain(page, repo, "A damaged list offers more than Plain shell (AC-9).");
      await expectLogged(server, "The damaged list is not in the server log (AC-9).", (line) =>
        line.includes("the starting scripts could not be read"),
      );
      check(
        (await NodeFSP.readFile(startingScriptsFile(server.home), "utf8")) === "{ damaged",
        "The damaged list file was overwritten (AC-9).",
      );

      stage = "AC-8";
      await NodeFSP.rm(startingScriptsFile(server.home));
      rpc = await restartAndReload(page, server, rpc, { PROBE_SEED_MOCK_AGENT: undefined });
      await expectOnlyPlain(page, repo, "A start without the default offers scripts (AC-8).");
      check(
        !(await NodeFSP.stat(startingScriptsFile(server.home)).catch(() => null)),
        "A start without the default wrote a list (AC-8).",
      );
      // With the default on again, a state folder with no list gets the mock agent (AC-23).
      rpc = await restartAndReload(page, server, rpc);
      check(
        (await readStartingScripts(server.home)).map((script) => script.name).join() ===
          "mock agent",
        "A state folder with no list was not given the mock agent (AC-23).",
      );
    } catch (error) {
      throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    } finally {
      await rpc.close();
    }
  },
};

async function expectOnlyPlain(page: PointerPage, project: string, message: string) {
  await openModal(page, project, { script: null });
  await selectedScriptKey(page);
  const offered = await scriptItems(page);
  check(
    JSON.stringify(offered) === JSON.stringify(["Plain shell"]),
    `${message} ${JSON.stringify(offered)}`,
  );
  await cancelModal(page);
}
