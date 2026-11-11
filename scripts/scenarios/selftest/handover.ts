import * as Effect from "effect/Effect";

import { expected } from "../lib/expect.ts";
import { given, projectPaths, setupOn, workspaceNames } from "../lib/setup.ts";
import { defineCheck } from "../scenario.ts";

/** Makes a workspace and hands it to the step that takes one. */
export const returnsWorkspace = defineCheck(import.meta.url, {
  id: "T16",
  title: "makes a workspace and returns it",
  needs: {},
  returns: "workspace",
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    return ctx.trail.stage("make a workspace", () => setup.workspace("t16"));
  },
});

/**
 * Takes a workspace, or makes its own when run alone, and adds a folder to it. It counts the
 * workspaces named by its own run: none when it was handed one, one when it ran alone.
 */
export const takesWorkspace = defineCheck(import.meta.url, {
  id: "T17",
  title: "takes a workspace or makes its own",
  needs: {},
  takes: "workspace",
  run: async (ctx, handed) => {
    const setup = await setupOn(ctx);
    const ws = await ctx.trail.stage("take or make a workspace", () =>
      given("workspace", handed, () => setup.workspace("t17")),
    );
    await ctx.trail.stage("count the workspaces this step made", async () => {
      const names = await Effect.runPromise(workspaceNames(setup.client));
      expected({
        what: "workspaces named by this step's run",
        expected: handed === undefined ? 1 : 0,
        found: names.filter((name) => name.includes(`-${ctx.runId}-`)).length,
      });
    });
    await ctx.trail.stage("add a folder to the workspace", async () => {
      const project = await setup.project(ws, await setup.folder());
      const paths = await Effect.runPromise(projectPaths(setup.client, ws.name));
      expected({ what: `the projects of ${ws.name}`, expected: [project.path], found: paths });
    });
  },
});
