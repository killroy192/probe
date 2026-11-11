import { definePerf } from "../scenario.ts";

/** Fails on purpose: no page opens within its 1 ms budget. */
export const overBudget = definePerf(import.meta.url, {
  id: "T34",
  title: "a perf self-test over its budget",
  needs: {},
  measure: { name: "open-a-page", limitMs: 1, limitFrom: "PRB.T-040 AC-11" },
  run: async (ctx) => {
    const from = performance.now();
    await ctx.openPage();
    return performance.now() - from;
  },
});
