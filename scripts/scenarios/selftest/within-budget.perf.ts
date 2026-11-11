import { definePerf } from "../scenario.ts";

/** Times a signed-in page's opening against a budget no machine misses. */
export const withinBudget = definePerf(import.meta.url, {
  id: "T33",
  title: "a perf self-test within its budget",
  needs: {},
  measure: { name: "open-a-page", limitMs: 60_000 },
  run: async (ctx) => {
    const from = performance.now();
    await ctx.openPage();
    return performance.now() - from;
  },
});
