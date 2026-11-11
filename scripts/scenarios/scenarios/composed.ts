import { defineComposed } from "../scenario.ts";
import { closeTabCheck } from "./close-tab.ts";
import { killClosedTab } from "./kill-shell.ts";

/** S5 hands its shell with the tab closed to S6, which kills it from the tree. */
export const closeThenKill = defineComposed(import.meta.url, {
  id: "composed.close-then-kill",
  title: "a shell whose tab was closed is killed from the tree",
  steps: [{ scenario: closeTabCheck }, { scenario: killClosedTab, given: { from: 1 } }],
});
