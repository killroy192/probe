// @effect-diagnostics nodeBuiltinImport:off - Reads and edits the starting scripts file in the throwaway home.

import * as NodeFSP from "node:fs/promises";

import type { StartingScript } from "@t3tools/contracts";

import { expected } from "../lib/expect.ts";
import { readStartingScripts, startingScriptsFile, writeStartingScripts } from "../lib/files.ts";
import { restartAndReload, showWorkspace } from "../lib/navigate.ts";
import { shellsOf } from "../lib/scoped.ts";
import { expectLogged, logEntries } from "../lib/serverLog.ts";
import { framedPage, framedWorld, type SetupContext } from "../lib/setup.ts";
import {
  agentTypedOnceAfterPrompt,
  history,
  listedShell,
  MOCK_AGENT_LINES,
  PROMPT_MARK,
  shellsIn,
  stripOsc,
} from "../lib/shells.ts";
import { dialog } from "../lib/ui/dialog.ts";
import {
  cancelModal,
  offeredScripts,
  openModal,
  pickItem,
  pickScript,
  scriptDropdown,
  scriptItems,
  preselectedScript,
  selectedScriptKey,
  startButton,
  startScriptThroughModal,
  startFromModal,
} from "../lib/ui/plusModal.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { openFromTree, shellNodes, shellRow } from "../lib/ui/tree.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";
import { MOCK_AGENT_COMMAND, type ServerHandle } from "../server.ts";

/** The prompt mark as it shows in a page frame's JSON text. */
const FRAME_PROMPT_MARK = JSON.stringify(PROMPT_MARK).slice(1, -1);

const count = (text: string, part: string) => text.split(part).length - 1;

const startLines = (server: ServerHandle) =>
  logEntries(server).filter((line) => line.includes("shell started"));

const echo: StartingScript = { id: "echo", name: "echo agent", command: "echo probe-$((40+2))" };

/** The mock agent the harness seeds a fresh state folder with. */
async function seededMock(server: ServerHandle) {
  const [mock] = await readStartingScripts(server.home);
  expected({
    what: "the first script of the harness state folder",
    expected: "mock agent",
    found: mock?.name,
  });
  return mock!;
}

/** A workspace with a git repo and a plain folder, shown on a fresh page whose frames are recorded. */
async function shownWorld(ctx: SetupContext & Pick<ScenarioContext, "openPage">, label: string) {
  const made = await framedWorld(ctx, {
    workspace: label,
    projects: [{ kind: "repo" }, { kind: "folder", label: "plain" }],
  });
  return { ...made, repo: made.projects[0]!, plain: made.projects[1]! };
}

export const plainPreselected = defineCheck(import.meta.url, {
  id: "E2-S3.plain-preselected",
  title: "Plain shell is preselected and starts a shell at its prompt",
  needs: {},
  verifies: ["starting-scripts/FR-3"],
  run: async (ctx) => {
    const { page, frames, setup, repo } = await shownWorld(ctx, "plain-preselected");
    await ctx.trail.stage("plain preselected", async () => {
      await openModal(page, repo.path, { script: null });
      expected({
        what: "the preselected starting script",
        expected: "plain",
        found: await selectedScriptKey(page),
      });
      const from = frames.mark();
      await startButton(page).click();
      await frames.until("the first prompt", (frame) => frame.includes(FRAME_PROMPT_MARK), from);
      await waitFor(dialog(page), '"Create shell" to close on the start', { state: "detached" });
      const started = await shellsIn(setup.shells.lists, repo.path, 1);
      expected({ what: `shells listed in ${repo.path}`, expected: 1, found: started.length });
    });
  },
});

export const freshList = defineCheck(import.meta.url, {
  id: "E2-S3.fresh-list",
  title: "a fresh state folder offers Plain shell and the mock agent",
  needs: { serverWide: "depends on the list a fresh state folder offers" },
  // One fresh state folder: the list it offers is the default it was seeded with.
  verifies: ["starting-scripts/FR-1", "starting-scripts/FR-15"],
  run: async (ctx) => {
    const { page, repo } = await shownWorld(ctx, "fresh-list");
    await ctx.trail.stage("fresh list offered", async () => {
      await openModal(page, repo.path, { script: null });
      expected({
        what: "whether the Starting script dropdown is enabled",
        expected: true,
        found: await scriptDropdown(page).isEnabled(),
      });
      expected({
        what: "the starting scripts a fresh state folder offers",
        expected: ["Plain shell", "mock agent"],
        found: await scriptItems(page),
      });
    });
  },
});

export const agentCommandIgnored = defineCheck(import.meta.url, {
  id: "E2-S3.agent-command-ignored",
  title: "a plain start types nothing with PROBE_AGENT_COMMAND set, and is logged as plain",
  needs: {
    condition: {
      why: "the server starts with PROBE_AGENT_COMMAND set",
      env: () => ({ PROBE_AGENT_COMMAND: MOCK_AGENT_COMMAND }),
    },
  },
  // One plain start in a worktree: what it types and how it is logged.
  verifies: ["starting-scripts/FR-4", "starting-scripts/FR-16"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const { page, frames, setup } = await framedPage(ctx);
    const made = await setup.repo({ linkedWorktree: true });
    expected({ what: "the repository's linked worktrees", expected: 1, found: made.linked.length });
    const linked = made.linked[0]!.path;
    const ws = await setup.workspace("agent-command-ignored");
    const repo = (await setup.project(ws, made)).path;
    await showWorkspace(page, ws);

    const shell = await trail.stage("plain start types nothing", async () => {
      await openModal(page, repo, { script: "Plain shell" });
      await pickItem(page, "Start in", linked);
      expected({
        what: "the refusal of the plain start in the worktree",
        expected: null,
        found: await startFromModal(page),
      });
      const [started] = await shellsIn(setup.shells.lists, linked, 1);
      expected({ what: "the plain shell's worktree", expected: linked, found: started?.worktree });
      await waitFor(shellRow(page, started!.shellId), `the tree row of shell ${started!.shellId}`);
      const typedFrom = frames.mark();
      // A line typed now runs after anything the server typed, so its output closes the check.
      await typeLine(page, "echo plain-$((40+2))");
      await frames.nothingSince(
        "the mock agent in a plain shell",
        (frame) => frame.includes("mock-agent") || frame.includes("Mock Agent"),
        typedFrom,
        { what: "the typed line's output", match: (frame) => frame.includes("plain-42") },
      );
      const shown = stripOsc(await history(setup.client, started!.shellId));
      expected({
        what: "the mock agent's text in the plain shell's history",
        expected: false,
        found: shown.includes("mock-agent") || shown.includes("Mock Agent"),
      });
      return started!;
    });

    await trail.stage("logged as plain", async () => {
      await expectLogged(
        server,
        `The plain start is not logged as plain: ${startLines(server).join("\n")}`,
        (line) =>
          line.includes("shell started") &&
          line.includes(shell.shellId) &&
          /script\W+plain/.test(line),
      );
    });
  },
});

export const agentOnceAfterPrompt = defineCheck(import.meta.url, {
  id: "E2-S1.agent-once-after-prompt",
  title: "a starting script started from the modal is typed once, after the first prompt",
  needs: {},
  verifies: ["starting-scripts/FR-5"],
  run: async (ctx) => {
    const { page, frames, setup, repo } = await shownWorld(ctx, "agent-once");
    await ctx.trail.stage("typed once after the prompt", async () => {
      const from = frames.mark();
      const started = await startScriptThroughModal(page, setup.shells, repo.path, "mock agent");
      await frames.until(
        "the mock agent's session line",
        (frame) => frame.includes(MOCK_AGENT_LINES.session),
        from,
      );
      const raw = ctx.server.rawOutput(started.shellId);
      const problem = agentTypedOnceAfterPrompt(raw, MOCK_AGENT_COMMAND, MOCK_AGENT_LINES);
      expected({
        what: "how the mock agent was typed into its shell",
        expected: null,
        found: problem === null ? null : `${problem}: ${JSON.stringify(raw.slice(0, 400))}`,
      });
    });
  },
});

export const listOffered = defineCheck(import.meta.url, {
  id: "E2-S1.list-offered",
  title: "the modal offers the user's list in order, an unnamed entry by its program",
  needs: { serverWide: "writes the list" },
  // One written list, read once from the modal: its order and its unnamed entry.
  verifies: ["starting-scripts/FR-1", "starting-scripts/FR-2"],
  run: async (ctx) => {
    const mock = await seededMock(ctx.server);
    await writeStartingScripts(ctx.server.home, [
      mock,
      echo,
      { id: "unnamed", name: "", command: "printf x" },
      { id: "echo-again", name: "echo agent", command: "echo again" },
    ]);
    const { page, repo } = await shownWorld(ctx, "list-offered");
    await ctx.trail.stage("list offered", async () => {
      expected({
        what: "the starting scripts the modal offers",
        expected: ["Plain shell", "mock agent", "echo agent", "printf", "echo agent"],
        found: await offeredScripts(page, repo.path),
      });
    });
  },
});

export const secondScript = defineCheck(import.meta.url, {
  id: "E2-S1.second-script",
  title: "a second script runs once after the prompt and is logged by name only",
  needs: { serverWide: "writes the list" },
  // One start of the echo script: it runs once and its start line names it and nothing more.
  verifies: ["starting-scripts/FR-5", "starting-scripts/FR-16", "starting-scripts/FR-17"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    await writeStartingScripts(server.home, [await seededMock(server), echo]);
    const { page, frames, setup, plain } = await shownWorld(ctx, "second-script");

    const started = await trail.stage("runs once", async () => {
      const from = frames.mark();
      const shell = await startScriptThroughModal(page, setup.shells, plain.path, "echo agent");
      await frames.until("the echo script's output", (frame) => frame.includes("probe-42"), from);
      const shown = stripOsc(await history(setup.client, shell.shellId));
      expected({
        what: `times the echo script's output shows in ${JSON.stringify(shown.slice(0, 400))}`,
        expected: 1,
        found: count(shown, "probe-42"),
      });
      return shell;
    });

    await trail.stage("logged by name", async () => {
      await expectLogged(
        server,
        "The echo script's start line lacks the script name.",
        (line) =>
          line.includes("shell started") &&
          line.includes(started.shellId) &&
          line.includes(echo.name),
      );
      expected({
        what: "start lines that carry a command line",
        expected: [],
        found: startLines(server).filter(
          (line) => line.includes("mock-agent.ts") || line.includes("probe-$"),
        ),
      });
    });
  },
});

export const renamedPreselected = defineCheck(import.meta.url, {
  id: "E2-S1.renamed-preselected",
  title: "a renamed script stays preselected",
  needs: { serverWide: "writes the list" },
  // One start, then a rename: the last start is preselected and stays so.
  verifies: ["starting-scripts/FR-6", "starting-scripts/FR-7"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const mock = await seededMock(server);
    await writeStartingScripts(server.home, [mock, echo]);
    const { page, setup, plain } = await shownWorld(ctx, "renamed-preselected");
    await trail.stage("start the echo script", () =>
      startScriptThroughModal(page, setup.shells, plain.path, "echo agent"),
    );
    await trail.stage("renamed stays preselected", async () => {
      await writeStartingScripts(server.home, [mock, { ...echo, name: "renamed" }]);
      expected({
        what: "the script preselected after its rename",
        expected: echo.id,
        found: await preselectedScript(page, plain.path),
      });
    });
  },
});

export const removedFallsBack = defineCheck(import.meta.url, {
  id: "E2-S1.removed-falls-back",
  title: "a removed script falls back to Plain shell without an error",
  needs: { serverWide: "writes the list" },
  verifies: ["starting-scripts/FR-8"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const mock = await seededMock(server);
    await writeStartingScripts(server.home, [mock, echo]);
    const { page, setup, plain } = await shownWorld(ctx, "removed-falls-back");
    await trail.stage("start the echo script", () =>
      startScriptThroughModal(page, setup.shells, plain.path, "echo agent"),
    );
    await trail.stage("removed falls back", async () => {
      await writeStartingScripts(server.home, [mock]);
      await openModal(page, plain.path, { script: null });
      expected({
        what: "the script preselected after its removal",
        expected: "plain",
        found: await selectedScriptKey(page),
      });
      expected({
        what: "alerts in the modal after the removal",
        expected: 0,
        found: await dialog(page).getByRole("alert").count(),
      });
      await cancelModal(page);
    });
  },
});

export const preselectAfterRestart = defineCheck(import.meta.url, {
  id: "E2-S1.preselect-after-restart",
  title: "each project preselects its last script after a restart, and the list is unchanged",
  needs: { restart: true, serverWide: "writes the list" },
  // One restart: each project's preselection and the list file are judged after it.
  verifies: ["starting-scripts/FR-6", "starting-scripts/FR-9", "starting-scripts/FR-10"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const mock = await seededMock(server);
    await writeStartingScripts(server.home, [mock, echo]);
    const made = await shownWorld(ctx, "preselect-after-restart");
    const { page, frames, setup, repo, plain } = made;

    await trail.stage("start the mock agent and the echo script", async () => {
      const agentFrom = frames.mark();
      await startScriptThroughModal(page, setup.shells, repo.path, "mock agent");
      await frames.until(
        "the mock agent's session line",
        (frame) => frame.includes(MOCK_AGENT_LINES.session),
        agentFrom,
      );
      const echoFrom = frames.mark();
      await startScriptThroughModal(page, setup.shells, plain.path, "echo agent");
      await frames.until(
        "the echo script's output",
        (frame) => frame.includes("probe-42"),
        echoFrom,
      );
    });

    await trail.stage("preselected after restart", async () => {
      const listBefore = await NodeFSP.readFile(startingScriptsFile(server.home), "utf8");
      await restartAndReload(ctx, page, made.workspace, setup);
      expected({
        what: "the scripts each project preselects after a restart",
        expected: { [repo.path]: mock.id, [plain.path]: echo.id },
        found: {
          [repo.path]: await preselectedScript(page, repo.path),
          [plain.path]: await preselectedScript(page, plain.path),
        },
      });
      expected({
        what: "the user list after the restart",
        expected: listBefore,
        found: await NodeFSP.readFile(startingScriptsFile(server.home), "utf8"),
      });
    });
  },
});

export const emptiedNotSeeded = defineCheck(import.meta.url, {
  id: "E2-S1.emptied-not-seeded",
  title: "an emptied list is not seeded again on a restart",
  needs: { restart: true, serverWide: "writes the list" },
  // One restart of an emptied list: what it offers and the file it leaves.
  verifies: ["starting-scripts/FR-10", "starting-scripts/FR-11"],
  run: async (ctx) => {
    const { server } = ctx;
    const made = await shownWorld(ctx, "emptied-not-seeded");
    await ctx.trail.stage("emptied list kept", async () => {
      await writeStartingScripts(server.home, []);
      await restartAndReload(ctx, made.page, made.workspace, made.setup);
      expected({
        what: "the starting scripts an emptied list offers after a restart",
        expected: ["Plain shell"],
        found: await offeredScripts(made.page, made.repo.path),
      });
      expected({
        what: "scripts in the emptied list file after the restart",
        expected: 0,
        found: (await readStartingScripts(server.home)).length,
      });
    });
  },
});

export const damagedKept = defineCheck(import.meta.url, {
  id: "E2-S1.damaged-kept",
  title: "a damaged list offers Plain shell only, is logged, and is kept",
  needs: { restart: true, serverWide: "writes the list" },
  // One restart of a damaged list: what it offers, its log line and the file it leaves.
  verifies: ["starting-scripts/FR-10", "starting-scripts/FR-12", "starting-scripts/FR-13"],
  run: async (ctx) => {
    const { server } = ctx;
    const made = await shownWorld(ctx, "damaged-kept");
    await ctx.trail.stage("damaged list kept", async () => {
      await NodeFSP.writeFile(startingScriptsFile(server.home), "{ damaged");
      await restartAndReload(ctx, made.page, made.workspace, made.setup);
      expected({
        what: "the starting scripts a damaged list offers",
        expected: ["Plain shell"],
        found: await offeredScripts(made.page, made.repo.path),
      });
      await expectLogged(server, "The damaged list is not in the server log.", (line) =>
        line.includes("the starting scripts could not be read"),
      );
      expected({
        what: "the damaged list file after the restart",
        expected: "{ damaged",
        found: await NodeFSP.readFile(startingScriptsFile(server.home), "utf8"),
      });
    });
  },
});

export const seedOffThenOn = defineCheck(import.meta.url, {
  id: "E2-S1.seed-off-then-on",
  title: "a server with no default offers Plain shell only and writes no list, until it has one",
  needs: {
    restart: true,
    serverWide: "writes the list",
    condition: {
      why: "the server starts with no mock agent to seed",
      env: () => ({ PROBE_SEED_MOCK_AGENT: undefined }),
    },
  },
  // One state folder with no list, read with the default off and then on.
  verifies: ["starting-scripts/FR-14", "starting-scripts/FR-15"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    const made = await shownWorld(ctx, "seed-off-then-on");
    await trail.stage("no default, no list", async () => {
      expected({
        what: "the starting scripts a server with no default offers",
        expected: ["Plain shell"],
        found: await offeredScripts(made.page, made.repo.path),
      });
      expected({
        what: "whether a server with no default wrote a list file",
        expected: false,
        found: (await NodeFSP.stat(startingScriptsFile(server.home)).catch(() => null)) !== null,
      });
    });
    await trail.stage("default on again", async () => {
      await restartAndReload(ctx, made.page, made.workspace, made.setup, { env: {} });
      expected({
        what: "the starting scripts once the default is on again",
        expected: ["Plain shell", "mock agent"],
        found: await offeredScripts(made.page, made.repo.path),
      });
      expected({
        what: "the scripts written to a state folder with no list",
        expected: ["mock agent"],
        found: (await readStartingScripts(server.home)).map((script) => script.name),
      });
    });
  },
});

export const missingProgram = defineCheck(import.meta.url, {
  id: "E2-S4.missing-program",
  title: "a start whose program is missing is refused naming the program, and leaves no shell",
  needs: { serverWide: "writes the list" },
  // One refused start: its alert by clicks only, the shell it removes, its log lines and the
  // modal left open for another try.
  verifies: [
    "starting-scripts/FR-17",
    "starting-scripts/FR-18",
    "starting-scripts/FR-19",
    "starting-scripts/FR-20",
    "starting-scripts/FR-21",
    "starting-scripts/FR-22",
    "workspaces/FR-25",
  ],
  run: async (ctx) => {
    const { server, trail } = ctx;
    await writeStartingScripts(server.home, [
      await seededMock(server),
      { id: "missing", name: "missing agent", command: "TOKEN=secret missing-cli --flag" },
    ]);
    const { page, setup, repo } = await shownWorld(ctx, "missing-program");
    const listedFrom = setup.shells.lists.mark();

    await trail.stage("refusal names the program", async () => {
      await openModal(page, repo.path, { script: "missing agent" });
      const refusal = (await startFromModal(page)) ?? "";
      expected({
        what: `whether the refusal ${JSON.stringify(refusal)} names missing-cli, --flag, TOKEN`,
        expected: [true, false, false],
        found: ["missing-cli", "--flag", "TOKEN"].map((part) => refusal.includes(part)),
      });
    });

    await trail.stage("refused shell leaves", async () => {
      // A list from before the start also has no shell there: the refused one must come, then go.
      const { lists } = setup.shells;
      const added = await lists.until(
        `the refused shell listed in ${repo.path}`,
        (list) => shellsOf(list, [repo]).length > 0,
        listedFrom,
      );
      await lists.until(
        `the refused shell to leave the list of ${repo.path}`,
        (list) => shellsOf(list, [repo]).length === 0,
        lists.seen.indexOf(added, listedFrom) + 1,
      );
      await waitFor(shellNodes(page, repo.path).first(), "the refused shell's tree row to go", {
        state: "detached",
      });
      expected({
        what: `tree rows under ${repo.path} after the refusal`,
        expected: 0,
        found: await shellNodes(page, repo.path).count(),
      });
    });

    await trail.stage("refusal logged", async () => {
      await expectLogged(
        server,
        "The log has no refusal line with the script, the program and the folder.",
        (line) =>
          line.includes("shell failed to start") &&
          line.includes("missing agent") &&
          line.includes("missing-cli") &&
          line.includes(repo.path),
      );
      expected({
        what: "log lines with an env assignment or an argument of the command line",
        expected: [],
        found: logEntries(server).filter(
          (line) => line.includes("TOKEN=") || line.includes("--flag"),
        ),
      });
    });

    await trail.stage("another start from the modal", async () => {
      await pickScript(page, "Plain shell");
      expected({
        what: "the refusal of the start after the refusal",
        expected: null,
        found: await startFromModal(page),
      });
      const [started] = await shellsIn(setup.shells.lists, repo.path, 1);
      expected({
        what: "the status of Plain shell started after the refusal",
        expected: "running",
        found: started?.status,
      });
    });
  },
});

export const exitingCommand = defineCheck(import.meta.url, {
  id: "E2-S4.exiting-command",
  title: "a command that exits leaves its shell running and taking input",
  needs: { serverWide: "writes the list" },
  verifies: ["starting-scripts/FR-23"],
  run: async (ctx) => {
    const { server, trail } = ctx;
    await writeStartingScripts(server.home, [
      await seededMock(server),
      { id: "quick", name: "quick exit", command: "sh -c 'echo quick-exit; exit 3'" },
    ]);
    const { page, frames, setup, repo } = await shownWorld(ctx, "exiting-command");

    const quick = await trail.stage("shell stays", async () => {
      const from = frames.mark();
      const started = await startScriptThroughModal(page, setup.shells, repo.path, "quick exit");
      await waitFor(shellRow(page, started.shellId), `the tree row of shell ${started.shellId}`);
      await openFromTree(page, started.shellId);
      await frames.until(
        "the quick command's output",
        (frame) => frame.includes("quick-exit"),
        from,
      );
      return started;
    });

    await trail.stage("takes input and stays running", async () => {
      const typedFrom = frames.mark();
      await typeLine(page, "echo typed-$((40+2))");
      await frames.until(
        "the typed line's output",
        (frame) => frame.includes("typed-42"),
        typedFrom,
      );
      const after = listedShell(setup.shells, quick.shellId);
      expected({
        what: "the shell after its command exited",
        expected: { status: "running", ended: null },
        found: { status: after?.status ?? "gone", ended: after?.ended ?? null },
      });
      await waitFor(shellRow(page, quick.shellId), `the tree row of shell ${quick.shellId}`);
    });
  },
});

export const successors = [
  plainPreselected,
  freshList,
  agentCommandIgnored,
  agentOnceAfterPrompt,
  listOffered,
  secondScript,
  renamedPreselected,
  removedFallsBack,
  preselectAfterRestart,
  emptiedNotSeeded,
  damagedKept,
  seedOffThenOn,
  missingProgram,
  exitingCommand,
];
