import { defineComposed } from "../scenario.ts";
import { closeTabCheck } from "./close-tab.ts";
import { killClosedTab } from "./kill-shell.ts";

/** The close-tab check hands its shell with the tab closed to the kill check, which kills it from the tree. */
export const closeThenKill = defineComposed(import.meta.url, {
  id: "composed.close-then-kill",
  title: "a shell whose tab was closed is killed from the tree",
  verifies: [
    "close-and-reopen/FR-1",
    "close-and-reopen/FR-2",
    "close-and-reopen/FR-3",
    "kill-shell/FR-3",
    "kill-shell/FR-7",
  ],
  steps: [{ scenario: closeTabCheck }, { scenario: killClosedTab, given: { from: 1 } }],
});
