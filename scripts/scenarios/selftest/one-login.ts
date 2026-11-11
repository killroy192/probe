import { defineCheck } from "../scenario.ts";
import { check } from "../lib/waits.ts";

/** Signed-in pages share one login per server; anonymous pages and a second server stay apart. */
export const oneLogin = defineCheck(import.meta.url, {
  id: "T4",
  title: "one login per server",
  needs: { restart: true, secondServer: true },
  run: async ({ server, openPage, openAnonymousPage, startSecondServer }) => {
    for (const _ of [1, 2, 3]) {
      const page = await openPage();
      await page.getByTestId("workspace-screen").waitFor();
    }
    check(server.pairings() === 1, `Three pages minted ${server.pairings()} logins.`);

    const anonymous = await openAnonymousPage();
    await anonymous.goto(server.origin);
    await anonymous.waitForURL((url) => url.pathname.startsWith("/pair"));
    check(server.pairings() === 1, "An anonymous page minted a login.");

    // A restart keeps the session (SA-3); a page opened after it needs no new login.
    await server.restart();
    const afterRestart = await openPage();
    await afterRestart.getByTestId("workspace-screen").waitFor();
    check(server.pairings() === 1, `After a restart the pages needed ${server.pairings()} logins.`);

    const second = await startSecondServer();
    check(second.pairings() === 0, "A second server shares the first one's login.");
  },
});
