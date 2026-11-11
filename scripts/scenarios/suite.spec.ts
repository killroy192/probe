import { test } from "@playwright/test";

import { checks, composed, pickedSelftests, selftests } from "./registry.ts";

// The only file that calls `test()`: one test per registered scenario, which stay data.
// Playwright Test has no `test.each`, so the cases are declared from a callback.
[...checks, ...composed, ...selftests, ...pickedSelftests].forEach((scenario) => {
  test(`${scenario.id} ${scenario.title}`, () => {
    throw new Error(`${scenario.id} runs on the new runner once its fixtures land (PRB.T-040)`);
  });
});
