// @effect-diagnostics nodeBuiltinImport:off - Makes a folder unwritable and tries to write into it.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { expected } from "../lib/expect.ts";
import { revokeWrite } from "../lib/files.ts";
import { defineCheck } from "../scenario.ts";

/**
 * Fails on purpose inside the step that made a folder unwritable, so the run must give its write
 * access back after the failure.
 */
export const failsWhileUnwritable = defineCheck(import.meta.url, {
  id: "T25",
  title: "fails while a folder is unwritable",
  needs: {},
  run: async (ctx) => {
    const folder = NodePath.join(ctx.server.home, "folders", ctx.runId, "t25-unwritable");
    await ctx.trail.stage("make a folder", () => NodeFSP.mkdir(folder, { recursive: true }));
    await ctx.trail.stage("fail while the folder is unwritable", () =>
      revokeWrite(ctx, folder, "an unwritable folder", async () => {
        const write = await NodeFSP.writeFile(NodePath.join(folder, "probe"), "").then(
          () => "written",
          (error: NodeJS.ErrnoException) => error.code ?? String(error),
        );
        expected({ what: `a write into ${folder}`, expected: "EACCES", found: write });
        throw new Error(`T25 fails on purpose while ${folder} is unwritable`);
      }),
    );
  },
});
