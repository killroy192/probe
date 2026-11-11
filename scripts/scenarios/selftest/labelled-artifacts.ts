// @effect-diagnostics globalConsole:off - The pages log a marker to their own browser console.

import type { Scenario } from "../scenario.ts";

/**
 * Fails on purpose in its second stage with two servers and a signed-in and an anonymous page
 * open, each page having logged a marker, so the run saves every labelled artifact.
 */
export const labelledArtifacts: Scenario = {
  id: "T15",
  title: "labelled failure artifacts",
  needs: { secondServer: true },
  run: async ({ server, trail, openPage, openAnonymousPage, startSecondServer }) => {
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
      throw new Error("T15 fails on purpose, so the run saves labelled artifacts");
    });
  },
};
