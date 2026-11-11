// @effect-diagnostics nodeBuiltinImport:off - Names the condition's value after the server's home.

import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { expected } from "../lib/expect.ts";
import { addStartingScript } from "../lib/files.ts";
import { setupOn } from "../lib/setup.ts";
import { followOutput, writeLine } from "../lib/shells.ts";
import { defineCheck } from "../scenario.ts";

/** Adds a starting script, which every scenario on its server would see, so it gets a server of its own. */
export const serverWideChange = defineCheck(import.meta.url, {
  id: "T23",
  title: "states a server-wide change",
  needs: { serverWide: "adds a starting script every scenario on its server lists" },
  run: async (ctx) => {
    const name = `t23-${ctx.runId}`;
    await ctx.trail.stage("add a starting script", () =>
      addStartingScript(ctx.server.home, { id: name, name, command: "true" }),
    );
    await ctx.trail.stage("find it in the server's list", async () => {
      const setup = await setupOn(ctx);
      const { scripts } = await Effect.runPromise(setup.client["startingScripts.list"]({}));
      expected({
        what: "starting scripts named by this run",
        expected: [name],
        found: scripts.filter((script) => script.name === name).map((script) => script.name),
      });
    });
  },
});

const conditionValue = (home: string) => `on-${NodePath.basename(home)}`;

/** Its server starts with `SCENARIO_CONDITION_T24` set; a plain shell on it prints the value back. */
export const serverCondition = defineCheck(import.meta.url, {
  id: "T24",
  title: "runs on a server started under a condition",
  needs: {
    condition: {
      why: "SCENARIO_CONDITION_T24 is set",
      env: (home) => ({ SCENARIO_CONDITION_T24: conditionValue(home) }),
    },
  },
  run: async (ctx) => {
    const setup = await setupOn(ctx);
    const shell = await ctx.trail.stage("start a plain shell", async () => {
      const ws = await setup.workspace("t24");
      return setup.shell(await setup.project(ws, await setup.folder()));
    });
    ctx.onStepEnd(`shell ${shell.shellId}`, () => setup.killShell(shell));
    const viewer = followOutput(setup.client, shell.shellId);
    ctx.onStepEnd(`the output of shell ${shell.shellId}`, viewer.stop);
    await ctx.trail.stage("read the condition back in the shell", async () => {
      const want = `T24=${conditionValue(ctx.server.home)}`;
      await writeLine(
        setup.client,
        setup.shells,
        shell.shellId,
        'echo "T24=$SCENARIO_CONDITION_T24"',
      );
      await viewer.output.until(
        `the line ${want} in shell ${shell.shellId}`,
        (event) => event.includes(want),
        0,
      );
    });
  },
});
