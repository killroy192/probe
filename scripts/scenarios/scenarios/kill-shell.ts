// @effect-diagnostics nodeBuiltinImport:off - Checks fixture folders in the throwaway home and ends a shell's process from outside.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { PointerPage } from "../browser.ts";
import { expected } from "../lib/expect.ts";
import { jobMarkers, jobPids, otherRunMarker, startDecoys } from "../lib/jobs.ts";
import { openTab, showWorkspace } from "../lib/navigate.ts";
import { expectMenuOffers, shellCountOf } from "../lib/scoped.ts";
import { expectLogged } from "../lib/serverLog.ts";
import {
  framedPage,
  given,
  mockAgent,
  setupOn,
  world,
  type Setup,
  type ShellResult,
} from "../lib/setup.ts";
import { agentReady, history, listedShell, running, shellEnded, survivors } from "../lib/shells.ts";
import { closeTab, shellTab } from "../lib/ui/tabs.ts";
import { typeLine } from "../lib/ui/terminal.ts";
import { answerConfirm, askToKill, killFromTree, shellRow } from "../lib/ui/tree.ts";
import { removeWorkspace, startScreenButton } from "../lib/ui/workspacesMenu.ts";
import { alive, waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

/** Runs `line` in a plain shell from its tab and waits for `echo`, which only its output spells. */
async function runInShell(
  ctx: ScenarioContext,
  { page, frames, setup }: Awaited<ReturnType<typeof framedPage>>,
  shell: ShellResult,
  line: string,
  echo: string,
) {
  await openTab(page, shell);
  const from = frames.mark();
  await typeLine(page, line);
  await frames
    .until(`"${echo}" in the shell`, (frame) => frame.includes(echo), from)
    .catch((error: unknown) => {
      // The raw output outlives the shell; the server forgets an ended one.
      const output = JSON.stringify(ctx.server.rawOutput(shell.shellId).slice(-600));
      const current = listedShell(setup.shells, shell.shellId);
      const listed = JSON.stringify(current ?? "not listed");
      throw new Error(
        `${error instanceof Error ? error.message : error} The shell's output ends with ${output}; it is ${listed}.`,
        { cause: error },
      );
    });
}

const endedLogged = (ctx: ScenarioContext, shell: ShellResult, message: string) =>
  expectLogged(
    ctx.server,
    message,
    (entry) =>
      entry.includes("shell ended") && entry.includes(shell.shellId) && entry.includes(shell.cwd),
  );

const expectRunning = (setup: Setup, shell: ShellResult, what: string) =>
  expected({ what, expected: true, found: running(setup.shells, shell.shellId) });

export const cancelKill = defineCheck(import.meta.url, {
  id: "S6.cancel-kill",
  title: "cancelling a kill's confirmation keeps the shell",
  needs: {},
  // One cancelled confirmation proves them: it was asked, and the shell stays.
  verifies: ["kill-shell/FR-1", "kill-shell/FR-2", "workspaces/FR-25"],
  run: async (ctx) => {
    const made = await world(ctx, {
      workspace: "s6-cancel",
      projects: [{ kind: "folder", label: "plain" }],
      shells: [{ project: 0 }],
      page: true,
    });
    const page = made.shown!.page;
    const shell = made.shells[0]!;
    await ctx.trail.stage("cancel the kill", async () => {
      await askToKill(page, shell.shellId);
      await answerConfirm(page, "Cancel");
      expectRunning(made.setup, shell, `shell ${shell.shellId} running after Cancel`);
      await waitFor(shellRow(page, shell.shellId), `the row of shell ${shell.shellId} to stay`);
    });
  },
});

export const killFromTreeScenario = defineCheck(import.meta.url, {
  id: "S6.kill-from-tree",
  title: "a kill from the tree ends the shell, its own jobs only, and its tab",
  needs: {},
  // One kill: the shell, its jobs, its tab and its log line all end with it; the decoys must not.
  verifies: [
    "kill-shell/FR-1",
    "kill-shell/FR-3",
    "kill-shell/FR-4",
    "kill-shell/FR-5",
    "kill-shell/FR-6",
    "kill-shell/FR-10",
    "workspaces/FR-25",
  ],
  run: async (ctx) => {
    const framed = await framedPage(ctx);
    const { page, setup } = framed;
    const ws = await setup.workspace("s6-kill");
    const plain = await setup.project(ws, await setup.folder("plain"));
    const shell = await setup.shell(plain);
    await showWorkspace(page, ws);
    const [bg, detached] = jobMarkers(ctx.runId, 2) as [number, number];

    const { jobs, decoys } = await ctx.trail.stage("jobs and decoys", async () => {
      const decoys = await startDecoys(ctx, [1601, otherRunMarker(ctx.runId, [bg, detached])]);
      // No `$!`: zsh would read its `!` as a history expansion.
      await runInShell(
        ctx,
        framed,
        shell,
        `sleep ${bg} & (sleep ${detached} &); echo s6-jobs-$((2*3))`,
        "s6-jobs-6",
      );
      const jobs = [...(await jobPids(bg)), ...(await jobPids(detached))];
      expected({
        what: `running jobs "sleep ${bg}" and "sleep ${detached}"`,
        expected: 2,
        found: jobs.filter(alive).length,
      });
      expected({
        what: "decoys matched as the shell's jobs",
        expected: [],
        found: decoys.filter((pid) => jobs.includes(pid)),
      });
      return { jobs, decoys };
    });

    await ctx.trail.stage("kill from the tree", async () => {
      await killFromTree(page, shell.shellId);
      await shellCountOf(setup.shells, [plain], 0);
      await shellEnded(setup.shells, shell);
    });

    await ctx.trail.stage("jobs end, decoys run", async () => {
      // The jobs are not the server's to report on, so only a bounded check can see them end.
      expected({
        what: "the shell's jobs left running",
        expected: [],
        found: await survivors(jobs),
      });
      expected({
        what: "decoys running after the kill",
        expected: decoys,
        found: decoys.filter(alive),
      });
    });

    await ctx.trail.stage("tab closes", () =>
      waitFor(shellTab(page, shell.shellId), `the tab of shell ${shell.shellId} to close`, {
        state: "detached",
      }),
    );

    await ctx.trail.stage("end logged", () =>
      endedLogged(ctx, shell, "The log has no end line with the id and folder."),
    );
  },
});

export const killClosedTab = defineCheck(import.meta.url, {
  id: "S6.kill-closed-tab",
  title: "killing a shell whose tab is closed only removes its row",
  needs: {},
  // One kill of a shell with its tab closed proves them: its row goes and no tab comes.
  verifies: ["kill-shell/FR-3", "kill-shell/FR-7"],
  takes: "closedTabShell",
  run: async (ctx, handed) => {
    const built: { setup?: Setup } = {};
    const closed = await ctx.trail.stage("a shell with its tab closed", () =>
      given("closedTabShell", handed, async () => {
        const made = await world(ctx, {
          workspace: "s6-closed",
          projects: [{ kind: "folder", label: "plain" }],
          shells: [{ project: 0 }],
          page: true,
        });
        built.setup = made.setup;
        const shown = made.shown!;
        const shell = made.shells[0]!;
        await openTab(shown.page, shell);
        await closeTab(shown.page, shell.shellId);
        return { kind: "closedTabShell" as const, shell, shown };
      }),
    );
    const { page } = closed.shown;
    const setup = built.setup ?? (await setupOn(ctx, { as: page }));

    await ctx.trail.stage("kill with the tab closed", async () => {
      await killFromTree(page, closed.shell.shellId);
      await shellEnded(setup.shells, closed.shell);
      expected({
        what: `tabs of shell ${closed.shell.shellId} after its kill`,
        expected: 0,
        found: await shellTab(page, closed.shell.shellId).count(),
      });
    });
  },
});

export const probeKill = defineCheck(import.meta.url, {
  id: "S6.probe-kill",
  title: "probe kill ends its own shell only and keeps the worktree",
  needs: {},
  // One `probe kill` in a shared worktree: its shell ends, the neighbour and the worktree stay.
  verifies: [
    "kill-shell/FR-12",
    "kill-shell/FR-13",
    "kill-shell/FR-9",
    "kill-shell/FR-10",
    "kill-shell/FR-3",
  ],
  run: async (ctx) => {
    const framed = await framedPage(ctx);
    const { page, frames, setup } = framed;
    const { client } = setup;
    const agent = { script: await mockAgent(client) };
    const ws = await setup.workspace("s6-probe");
    const repo = await setup.project(ws, await setup.repo());
    await showWorkspace(page, ws);

    const { worktree, neighbour } = await ctx.trail.stage("probe kill", async () => {
      const forked = await setup.shell(repo, {
        worktree: { fork: { from: { kind: "branch", name: "main" } } },
      });
      const worktree = forked.cwd;
      const neighbour = await setup.shell(repo, { ...agent, worktree: { existing: worktree } });
      await openTab(page, neighbour);
      await agentReady(client, neighbour.shellId);
      const typedNeighbour = frames.mark();
      await typeLine(page, "neighbour-line-s6");
      await frames.until(
        "the neighbour's line",
        (frame) => frame.includes("echo: neighbour-line-s6"),
        typedNeighbour,
      );
      await openTab(page, forked);
      await typeLine(page, 'probe kill || "$PROBE_BIN" kill');
      await shellEnded(setup.shells, forked).catch(async (error: unknown) => {
        const tail = (await history(client, forked.shellId)).slice(-600);
        throw new Error(`${error instanceof Error ? error.message : error} Shell shows: ${tail}`, {
          cause: error,
        });
      });
      await endedLogged(ctx, forked, "The log has no end line for probe kill.");
      return { worktree, neighbour };
    });

    await ctx.trail.stage("the other shell runs on", async () => {
      expectRunning(setup, neighbour, "the other shell running after probe kill");
      expected({
        what: "the other shell's history holds its line",
        expected: true,
        found: (await history(client, neighbour.shellId)).includes("echo: neighbour-line-s6"),
      });
      await NodeFSP.access(worktree);
    });

    await ctx.trail.stage("worktree kept", async () => {
      await killFromTree(page, neighbour.shellId);
      await shellEnded(setup.shells, neighbour);
      await NodeFSP.access(worktree);
    });
  },
});

export const killUnreachable = defineCheck(import.meta.url, {
  id: "S6.kill-unreachable",
  title: "a kill command that cannot reach the server says so and the shell runs on",
  needs: {},
  // One unreachable `probe kill` proves them: it says why and exits 1, and its shell runs on.
  verifies: ["kill-shell/FR-14", "kill-shell/FR-15"],
  run: async (ctx) => {
    const framed = await framedPage(ctx);
    const { page, setup } = framed;
    const ws = await setup.workspace("s6-unreachable");
    const plain = await setup.project(ws, await setup.folder("plain"));
    const shell = await setup.shell(plain);
    await showWorkspace(page, ws);

    await ctx.trail.stage("kill unreachable", async () => {
      await runInShell(
        ctx,
        framed,
        shell,
        'PROBE_SHELL_ENDPOINT=http://127.0.0.1:9/ "$PROBE_BIN" kill; echo exit-$?-s6',
        "exit-1-s6",
      );
      expected({
        what: "the kill command's reason in the shell",
        expected: true,
        found: (await history(setup.client, shell.shellId)).includes("could not reach Probe"),
      });
      expectRunning(setup, shell, "the shell running after the unreachable kill");
    });
  },
});

export const endedDuringConfirm = defineCheck(import.meta.url, {
  id: "S6.ended-during-confirm",
  title: "a shell that ended while its confirmation was open leaves without an error",
  needs: {},
  verifies: ["kill-shell/FR-11"],
  run: async (ctx) => {
    const made = await world(ctx, {
      workspace: "s6-vanished",
      projects: [{ kind: "folder", label: "plain" }],
      shells: [{ project: 0 }],
      page: true,
    });
    const page = made.shown!.page;
    const vanished = made.shells[0]!;

    await ctx.trail.stage("ended during the confirmation", async () => {
      await askToKill(page, vanished.shellId);
      NodeProcess.kill(vanished.pid!, "SIGKILL");
      await shellEnded(made.setup.shells, vanished);
      await answerConfirm(page, "Confirm");
      await waitFor(
        shellRow(page, vanished.shellId),
        `the row of shell ${vanished.shellId} to leave the tree`,
        { state: "detached" },
      );
      expected({
        what: "alerts after killing an ended shell",
        expected: 0,
        found: await page.getByRole("alert").count(),
      });
    });
  },
});

async function removeProjectFromTree(page: PointerPage, path: string, runningShells: number) {
  const project = page.locator(`[data-project="${path}"]`);
  const label = NodePath.basename(path);
  await project.getByRole("treeitem", { level: 2 }).hover();
  await project.getByRole("button", { name: new RegExp(`^Remove ${label} from`) }).click();
  await waitFor(
    page.getByRole("alertdialog").getByText(`Its ${runningShells} running shells are killed.`),
    `the confirmation to name the project's ${runningShells} running shells`,
  );
  await answerConfirm(page, "Confirm");
  await waitFor(project, `project ${path} to leave the tree`, { state: "detached" });
}

export const removeProject = defineCheck(import.meta.url, {
  id: "S6.remove-project",
  title: "removing a project kills its shells and keeps its folder and the other project's shell",
  needs: {},
  // One project removal proves them: it asks, kills its shells, keeps its folder and the others.
  verifies: ["kill-shell/FR-16", "kill-shell/FR-17", "kill-shell/FR-18", "kill-shell/FR-19"],
  run: async (ctx) => {
    const made = await world(ctx, {
      workspace: "s6-project",
      projects: [
        { kind: "folder", label: "extra" },
        { kind: "folder", label: "other" },
      ],
      shells: [{ project: 0, count: 2 }, { project: 1 }],
      page: true,
    });
    const page = made.shown!.page;
    const extra = made.projects[0]!;
    const inExtra = made.shells.slice(0, 2);
    const other = made.shells[2]!;

    await ctx.trail.stage("remove project", async () => {
      await removeProjectFromTree(page, extra.path, inExtra.length);
      for (const shell of inExtra) await shellEnded(made.setup.shells, shell);
      expectRunning(made.setup, other, "the other project's shell running after the removal");
      await NodeFSP.access(extra.path);
    });
  },
});

export const removeWorkspaceScenario = defineCheck(import.meta.url, {
  id: "S6.remove-workspace",
  title: "removing a workspace kills its running shells and keeps its folders",
  needs: {},
  // One removal: its shells end, its folders, the worktree's included, stay, the start screen shows.
  verifies: ["kill-shell/FR-20", "kill-shell/FR-21", "workspaces/FR-11", "workspaces/FR-12"],
  run: async (ctx) => {
    const made = await world(ctx, {
      workspace: "s6-remove",
      projects: [
        { kind: "repo", label: "repo" },
        { kind: "folder", label: "plain" },
      ],
      shells: [
        { project: 0 },
        {
          project: 0,
          worktree: { fork: { from: { kind: "branch", name: "main" } } },
        },
        { project: 1 },
      ],
      page: true,
    });
    const page = made.shown!.page;
    const { setup } = made;
    const kept = await setup.workspace("s6-kept");

    await ctx.trail.stage("remove the workspace", async () => {
      expected({
        what: "shells of the workspace running before its removal",
        expected: made.shells.length,
        found: made.shells.filter((shell) => shell.pid !== null && alive(shell.pid)).length,
      });
      await removeWorkspace(page, made.workspace.name);
      await waitFor(
        startScreenButton(page, "Open workspace"),
        "the start screen after removing the workspace",
      );
      for (const shell of made.shells) await shellEnded(setup.shells, shell);
      await expectMenuOffers(page, "Open workspace", {
        includes: [kept.name],
        excludes: [made.workspace.name],
      });
    });

    await ctx.trail.stage("folders kept", async () => {
      const folders = new Set([
        ...made.projects.map(({ path }) => path),
        ...made.shells.map(({ cwd }) => cwd),
      ]);
      for (const folder of folders) await NodeFSP.access(folder);
    });
  },
});

export const successors = [
  cancelKill,
  killFromTreeScenario,
  killClosedTab,
  probeKill,
  killUnreachable,
  endedDuringConfirm,
  removeProject,
  removeWorkspaceScenario,
];
