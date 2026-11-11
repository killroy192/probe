// @effect-diagnostics globalConsole:off - The pages log a marker to their own browser console.

import { expectLogged } from "../lib/serverLog.ts";
import { setupOn } from "../lib/setup.ts";
import type { Scenario } from "../scenario.ts";

/**
 * Fails on purpose in its second stage with two servers and a signed-in and an anonymous page
 * open, each page having logged a marker, so the run saves every labelled artifact.
 */
export const labelledArtifacts: Scenario = {
  id: "T15",
  title: "labelled failure artifacts",
  needs: { secondServer: true },
  run: async (ctx) => {
    const { server, trail, openPage, openAnonymousPage, startSecondServer } = ctx;
    const signedIn = await trail.stage("open two pages on two servers", async () => {
      await startSecondServer();
      const page = await openPage();
      await page.getByTestId("workspace-screen").waitFor();
      await page.evaluate(() => console.log("T15 marker signed-in"));
      const anonymous = await openAnonymousPage();
      await anonymous.goto(server.origin);
      await anonymous.waitForURL((url) => url.pathname.startsWith("/pair"));
      await anonymous.evaluate(() => console.log("T15 marker anonymous"));
      return page;
    });
    await trail.stage("fail after a reload", async () => {
      await signedIn.reload();
      await signedIn.getByTestId("workspace-screen").waitFor();
      // A shell's first prompt is a debug entry, so the stage's slice holds one.
      const setup = await setupOn(ctx, { as: signedIn });
      const ws = await setup.workspace("t15");
      const shell = await setup.shell(await setup.project(ws, await setup.folder()));
      await expectLogged(
        server,
        `the first prompt entry of shell ${shell.shellId}`,
        (entry) => entry.includes("shell first prompt") && entry.includes(shell.shellId),
      );
      throw new Error("T15 fails on purpose, so the run saves labelled artifacts");
    });
  },
};
