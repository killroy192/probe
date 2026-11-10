import type { Scenario } from "../scenario.ts";
import { pageFrames } from "../support.ts";

/** Fails on purpose once a page is open, so the run saves a screenshot, log tail and recorded values. */
export const deliberateFailure: Scenario = {
  id: "T2",
  title: "deliberate failure",
  run: async ({ openPage }) => {
    const page = await openPage();
    pageFrames(page).push("a value the failure keeps");
    throw new Error("deliberate failure to prove failures are reported");
  },
};
