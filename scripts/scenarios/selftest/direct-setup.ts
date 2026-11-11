// @effect-diagnostics nodeBuiltinImport:off - Names a folder that does not exist in the server's home.

import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { openTab, reloadShowing, showWorkspace } from "../lib/navigate.ts";
import { setupOn, world } from "../lib/setup.ts";
import { check } from "../lib/waits.ts";
import type { Scenario } from "../scenario.ts";

/** The same setup twice on one server: distinct names and folders, each seeing only its own. */
export const twoSetups: Scenario = {
  id: "T10",
  title: "two setups on one server",
  needs: {},
  run: async (ctx) => {
    const spec = { projects: [{ kind: "repo" as const }], shells: [{ project: 0 }] };
    const first = await ctx.trail.stage("set up the first world", () => world(ctx, spec));
    const second = await ctx.trail.stage("set up the second world", () => world(ctx, spec));
    await ctx.trail.stage("compare the worlds", async () => {
      const [a, b] = [first, second];
      check(
        a.workspace.name !== b.workspace.name,
        `Both setups named their workspace ${a.workspace.name}.`,
      );
      check(
        a.projects[0]!.path !== b.projects[0]!.path,
        `Both setups made the folder ${a.projects[0]!.path}.`,
      );
      for (const { workspace, projects, shells, setup } of [a, b]) {
        const detail = await Effect.runPromise(
          setup.client["workspace.open"]({ name: workspace.name }),
        );
        const paths = detail.projects.map(({ path }) => path);
        check(
          paths.length === 1 && paths[0] === projects[0]!.path,
          `${workspace.name} holds ${JSON.stringify(paths)}, not only ${projects[0]!.path}.`,
        );
        const shell = shells[0]!;
        check(
          shell.cwd === projects[0]!.path,
          `Shell ${shell.shellId} started in ${shell.cwd}, not in ${projects[0]!.path}.`,
        );
      }
    });
    await ctx.trail.stage("remove both worlds", async () => {
      for (const { workspace, projects, shells, setup } of [first, second]) {
        await setup.killShell(shells[0]!);
        await setup.removeProject(projects[0]!);
        await setup.removeWorkspace(workspace);
      }
    });
  },
};

/** A page reaches a workspace made over the API from the start screen and from another workspace. */
export const reachWorkspace: Scenario = {
  id: "T11",
  title: "reach an API-made workspace",
  needs: {},
  run: async (ctx) => {
    const page = await ctx.openPage();
    const setup = await setupOn(ctx, { as: page });
    const first = await ctx.trail.stage("set up the first workspace", async () => {
      const ws = await setup.workspace("first");
      const project = await setup.project(ws, await setup.folder());
      return { ws, shell: await setup.shell(project) };
    });
    await ctx.trail.stage("show it from the start screen", async () => {
      await page
        .getByTestId("workspace-screen")
        .getByRole("button", { name: "Open workspace" })
        .waitFor();
      await showWorkspace(page, first.ws);
    });
    await ctx.trail.stage("open its shell's tab from the tree", () => openTab(page, first.shell));
    await ctx.trail.stage("show another from the remembered one", async () => {
      await reloadShowing(page, first.ws.name);
      const other = await setup.workspace("second");
      await showWorkspace(page, other);
    });
  },
};

/** Fails on purpose: a project import of a folder that does not exist fails in setup. */
export const setupCallFails: Scenario = {
  id: "T12",
  title: "a setup call fails",
  needs: {},
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const ws = await setup.workspace("t12");
    const missing = NodePath.join(ctx.server.home, "folders", ctx.runId, "missing");
    await ctx.trail.stage("setup", () => setup.project(ws, { kind: "folder", path: missing }));
  },
};

/** Fails on purpose: a page asked to show a workspace that does not exist. */
export const workspaceNotShown: Scenario = {
  id: "T13",
  title: "a workspace is not shown",
  needs: {},
  run: async (ctx) => {
    const page = await ctx.openPage();
    await ctx.trail.stage("show a workspace that does not exist", () =>
      showWorkspace(page, { kind: "workspace", name: `missing-${ctx.runId}` }),
    );
  },
};
