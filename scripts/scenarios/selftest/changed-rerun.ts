// @effect-diagnostics nodeBuiltinImport:off - Makes its folder in the server's home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { withClient } from "../lib/api.ts";
import { issueBearerToken } from "../lib/seam.ts";
import type { Scenario } from "../scenario.ts";

/**
 * Makes a workspace and a folder named by its run, failing if either exists, and writes the note it
 * is given, so a test can change it between two runs on one sandbox. Picked only by id.
 */
export const changedRerun: Scenario = {
  id: "T6",
  title: "names what it makes by its run",
  needs: {},
  run: async ({ server, runId }) => {
    const workspace = `t6-${runId}`;
    const folder = NodePath.join(server.home, "folders", runId, "t6");
    await NodeFSP.mkdir(NodePath.dirname(folder), { recursive: true });
    // Not recursive: a folder an earlier run made fails the scenario.
    await NodeFSP.mkdir(folder);
    await NodeFSP.writeFile(NodePath.join(folder, "note"), NodeProcess.env.SCENARIO_T6_NOTE ?? "");
    await withClient(server.origin, await issueBearerToken(server), (client) =>
      client["workspace.create"]({ name: workspace }),
    );
    NodeProcess.stdout.write(`T6 made workspace=${workspace} folder=${folder}\n`);
  },
};
