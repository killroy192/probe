import * as Effect from "effect/Effect";

import { expected } from "../lib/expect.ts";
import { workspaceNames, world } from "../lib/setup.ts";
import { shellNodes, shellRow } from "../lib/ui/tree.ts";
import { waitFor } from "../lib/waits.ts";
import { defineCheck, type ScenarioContext } from "../scenario.ts";

/** A workspace with one folder and two shells, shown on a signed-in page with both rows. */
const shownWorld = (ctx: ScenarioContext, label: string) =>
  ctx.trail.stage("show a workspace with two shells", async () => {
    const made = await world(ctx, {
      projects: [{ kind: "folder", label }],
      shells: [{ project: 0, count: 2 }],
      page: true,
    });
    for (const shell of made.shells) {
      await waitFor(
        shellRow(made.shown!.page, shell.shellId),
        `the tree row of shell ${shell.shellId}`,
      );
    }
    return made;
  });

/** Judges only what its own run made, so it passes beside any other run on its server. */
const ownOnly = (id: "T29" | "T30") =>
  defineCheck(import.meta.url, {
    id,
    title: "sees only its own workspace and shells on a shared server",
    needs: {},
    run: async (ctx) => {
      const made = await shownWorld(ctx, id.toLowerCase());
      await ctx.trail.stage("count its own workspaces and shells", async () => {
        const names = await Effect.runPromise(workspaceNames(made.setup.client));
        expected({
          what: "workspaces named by this run",
          expected: [made.workspace.name],
          found: names.filter((name) => name.includes(`-${ctx.runId}-`)),
        });
        const rows = await shellNodes(made.shown!.page).all();
        const ids = await Promise.all(rows.map((row) => row.getAttribute("data-shell-id")));
        expected({
          what: `shell rows the tree shows for ${made.workspace.name}`,
          expected: made.shells.map(({ shellId }) => shellId).sort(),
          found: [...new Set(ids)].sort(),
        });
      });
    },
  });

export const ownWorkspaceFirst = ownOnly("T29");
export const ownWorkspaceSecond = ownOnly("T30");

/** The negative control: it judges every workspace on its server, so a run before it fails it. */
export const everyWorkspace = defineCheck(import.meta.url, {
  id: "T31",
  title: "counts every workspace on its server (negative control)",
  // Untrue on purpose: it depends on server-wide state, to show that sharing breaks such a check.
  needs: {},
  run: async (ctx) => {
    const made = await shownWorld(ctx, "t31");
    await ctx.trail.stage("count every workspace on the server", async () => {
      expected({
        what: "every workspace on the server",
        expected: [made.workspace.name],
        found: await Effect.runPromise(workspaceNames(made.setup.client)),
      });
    });
  },
});
