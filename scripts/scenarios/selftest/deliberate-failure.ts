import type { Scenario } from "../scenario.ts";

export const deliberateFailure: Scenario = {
  id: "T2",
  title: "deliberate failure",
  run: async () => {
    throw new Error("deliberate failure to prove failures are reported");
  },
};
