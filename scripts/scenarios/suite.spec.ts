import * as NodeProcess from "node:process";

import { test } from "@playwright/test";

import { readRunPlan } from "./environment.ts";
import { checks, composed, pickedSelftests, selftests } from "./registry.ts";

const registered = new Map(
  [...checks, ...composed, ...selftests, ...pickedSelftests].map((scenario) => [
    scenario.id,
    scenario,
  ]),
);
const planned = readRunPlan(NodeProcess.env)?.ids ?? [...registered.keys()];

// The only file that calls `test()`: one test per registered scenario, which stay data.
// Playwright Test has no `test.each`, so the cases are declared from a callback.
planned.forEach((id) => {
  const scenario = registered.get(id)!;
  test(`${scenario.id} ${scenario.title}`, () => {
    throw new Error(`${scenario.id} runs on the new runner once its fixtures land (PRB.T-040)`);
  });
});
