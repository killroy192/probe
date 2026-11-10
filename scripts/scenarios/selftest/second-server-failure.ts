// @effect-diagnostics nodeBuiltinImport:off - Names a server binary that does not exist.

import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { Scenario } from "../scenario.ts";

/**
 * Fails on purpose: a second server that never becomes ready fails the scenario with that
 * server's output, and the one started before it is still stopped.
 */
export const secondServerFailure: Scenario = {
  id: "T3",
  title: "second server cannot start",
  needs: { secondServer: true },
  run: async ({ startSecondServer }) => {
    await startSecondServer();
    await startSecondServer({
      serverBin: NodePath.join(NodeOS.tmpdir(), "scenario-missing", "bin.ts"),
    });
  },
};
