import * as NodeProcess from "node:process";

import { readRunPlan } from "./environment.ts";
import { checks, composed, perfScenarios, pickedSelftests, selftests } from "./registry.ts";
import type { AnyScenario } from "./scenario.ts";
import { scenarioTest as test } from "./testFixtures.ts";

const registered = new Map<string, AnyScenario>(
  [...checks, ...composed, ...perfScenarios, ...selftests, ...pickedSelftests].map((scenario) => [
    scenario.id,
    scenario,
  ]),
);
const planned = readRunPlan(NodeProcess.env)?.ids ?? [...registered.keys()];

// The only file that calls `test()`: one test per planned scenario, which stay data.
// Playwright Test has no `test.each`, so the cases are declared from a callback.
planned.forEach((id) => {
  const scenario = registered.get(id);
  if (scenario === undefined) throw new Error(`The run plan names ${id}, which is not registered.`);
  test(`${scenario.id} ${scenario.title}`, ({ runScenario }) => runScenario(scenario));
});
