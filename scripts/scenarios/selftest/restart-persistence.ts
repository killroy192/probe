// @effect-diagnostics nodeBuiltinImport:off - Creates a workspace directory inside the throwaway home.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { Scenario } from "../scenario.ts";

const TITLE = "persisted-project";

export const restartPersistence: Scenario = {
  id: "T1",
  title: "restart keeps data",
  run: async ({ server, openPage }) => {
    const workspace = NodePath.join(server.home, "workspace");
    await NodeFSP.mkdir(workspace);
    await server.cli(["project", "add", workspace, "--title", TITLE]);

    await server.restart();

    const page = await openPage();
    await page.getByText(TITLE).first().waitFor();
  },
};
