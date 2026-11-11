import type { Scenario } from "../scenario.ts";
import { pageFrames } from "../lib/network.ts";

/**
 * Fails on purpose in a named stage, with what it expected and found, once a page is open, so the
 * run saves a screenshot, log tail and recorded values.
 */
export const deliberateFailure: Scenario = {
  id: "T2",
  title: "deliberate failure",
  needs: {},
  run: async ({ openPage }) => {
    const page = await openPage();
    pageFrames(page).push("a value the failure keeps");
    const found = await page.title();
    throw new Error(
      `deliberate failure to prove failures are reported, at stage "read the page title": expected "a title no page has", found ${JSON.stringify(found)}`,
    );
  },
};
